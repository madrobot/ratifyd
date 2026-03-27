import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import { MonacoBinding } from 'y-monaco'
import type * as monaco from 'monaco-editor'
import { ROLES, SIGNALING_SERVERS, YJS_ROOM_PREFIX } from '../constants'
import type { Role } from '../constants'
import { Claim } from './Claim'
import { Identity } from './Identity'
import { SessionKey } from './SessionKey'
import type { EncryptedBlob } from './SessionKey'
import { SelfSovereignPKI } from './SelfSovereignPKI'
import { State } from './State'
import type { EncryptedChatEntry } from './State'
import { AuthError } from './error/AuthError'
import { RoomError } from './error/RoomError'
import { bufferToBase64url } from './helper'

export type RoomStatus = 'connecting' | 'awaiting' | 'connected' | 'error'

export type { EncryptedBlob }

export interface AdmittedPeer {
  peerId: string
  role: Role
  admittedAt: number
}

export interface DecryptedMessage {
  id: string
  peerId: string
  text: string
  sentAt: number
}

interface ExcalidrawAPI {
  updateScene(opts: { elements: unknown[] }): void
}

type ExcalidrawElement = unknown

export class Room {
  #id!: string
  #identity!: Identity
  #role!: Role
  #sessionKey: SessionKey | null = null
  #doc!: Y.Doc
  #webrtc!: WebrtcProvider
  #indexeddb!: IndexeddbPersistence
  #state!: State
  #protocol!: SelfSovereignPKI
  #status!: RoomStatus
  #emitter: Map<string, Set<(...args: unknown[]) => void>> = new Map()
  #messageCache: DecryptedMessage[] = []
  #token!: string
  #teardown: (() => void)[] = []
  #pendingAdmission = new Map<
    string,
    { token: string; signingPubKeyB64: string; oaepPubKeyB64: string | null }
  >()
  #destroyed = false
  #messageObserverAttached = false

  private constructor() {}

  static async create(): Promise<Room> {
    const room = new Room()
    const identity = await Identity.create(undefined, true)
    await identity.save()
    const roomId = crypto.randomUUID()
    const sessionKey = await SessionKey.generate()
    await sessionKey.save(roomId)
    room.#id = roomId
    room.#identity = identity
    room.#role = ROLES.OWNER
    room.#sessionKey = sessionKey
    room.#doc = new Y.Doc()
    room.#indexeddb = new IndexeddbPersistence(YJS_ROOM_PREFIX + roomId, room.#doc)
    room.#webrtc = new WebrtcProvider(YJS_ROOM_PREFIX + roomId, room.#doc, {
      signaling: SIGNALING_SERVERS,
    })
    await new Promise<void>((resolve) => room.#indexeddb.on('synced', resolve))
    room.#state = new State(room.#doc)
    room.#protocol = new SelfSovereignPKI()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    room.#state.addPeer(claim, await identity.getSigningPublicKeyB64())
    room.#token = claim.raw
    room.#status = 'connected'
    room.#setupPeerLeftListener()
    room.#setupOwnerSideHandlers()
    room.#setupMessageObserver()
    return room
  }

  static async join(token: string): Promise<Room> {
    const room = new Room()
    const roomId = await Claim.peek(token, 'room')
    const roleHint = await Claim.peek(token, 'role')
    const issHint = await Claim.peek(token, 'iss')
    const needsOaep = roleHint !== ROLES.GUEST
    const existingIdentity = await Identity.load()
    const identity =
      existingIdentity ?? (await (await Identity.create(undefined, needsOaep)).save())
    room.#id = roomId
    room.#identity = identity
    room.#role = roleHint as Role
    room.#token = token
    room.#doc = new Y.Doc()
    room.#indexeddb = new IndexeddbPersistence(YJS_ROOM_PREFIX + roomId, room.#doc)
    room.#webrtc = new WebrtcProvider(YJS_ROOM_PREFIX + roomId, room.#doc, {
      signaling: SIGNALING_SERVERS,
    })
    await new Promise<void>((resolve) => room.#indexeddb.on('synced', resolve))
    room.#state = new State(room.#doc)
    room.#protocol = new SelfSovereignPKI()

    const isOwnerSelfAdmit =
      roleHint === ROLES.OWNER &&
      identity.id === issHint &&
      room.#webrtc.awareness.getStates().size === 0

    if (isOwnerSelfAdmit) {
      room.#sessionKey = await SessionKey.load(roomId)
      if (!room.#sessionKey) {
        room.#status = 'error'
        room.#emit(
          'error',
          new RoomError('Owner room key not found in storage — possible storage clear'),
        )
        return room
      }
      const claim = await identity.verifyClaim(token)
      room.#state.addPeer(claim, await identity.getSigningPublicKeyB64())
      room.#setupPeerLeftListener()
      room.#setupOwnerSideHandlers()
      room.#setupMessageObserver()
      room.#status = 'connected'
    } else {
      room.#setupOwnerSideHandlers()
      room.#setupPeerSideHandlers()
      room.#setupPeerLeftListener()
      const ownerOnline = room.#isOwnerOnline()
      if (ownerOnline) {
        room.#status = 'connecting'
        await room.#sendAdmissionRequest()
      } else {
        room.#status = 'awaiting'
        room.#setupAwaitingOwnerWatch()
      }
    }

    return room
  }

  // ── Private methods ──────────────────────────────────────────────────────────

  #setupPeerLeftListener(): void {
    const handler = ({ removed }: { removed: number[] }) => {
      for (const clientId of removed) {
        this.#emit('peer-left', String(clientId))
      }
    }
    this.#webrtc.awareness.on('change', handler)
    this.#teardown.push(() => {
      this.#webrtc.awareness.off('change', handler)
    })
  }

  #isOwnerOnline(): boolean {
    const states = this.#webrtc.awareness.getStates()
    return [...states.values()].some((s) => (s as Record<string, unknown>)['role'] === ROLES.OWNER)
  }

  #setupAwaitingOwnerWatch(): void {
    const handler = async () => {
      if (this.#status !== 'awaiting') return
      if (this.#isOwnerOnline()) {
        this.#status = 'connecting'
        await this.#sendAdmissionRequest()
      }
    }
    this.#webrtc.awareness.on('change', handler)
    this.#teardown.push(() => {
      this.#webrtc.awareness.off('change', handler)
    })
  }

  async #sendAdmissionRequest(): Promise<void> {
    const state = {
      type: 'admission-request',
      token: this.#token,
      signingPubKeyB64: await this.#identity.getSigningPublicKeyB64(),
      oaepPubKeyB64: await this.#identity.getOaepPublicKeyB64(),
    }
    this.#webrtc.awareness.setLocalStateField('adm', state)
  }

  #setupPeerSideHandlers(): void {
    const myClientId = this.#webrtc.awareness.clientID
    const handler = async (_: unknown, origin: unknown) => {
      if (origin === 'local') return
      const states = this.#webrtc.awareness.getStates()
      for (const [clientId, state] of states) {
        if (clientId === myClientId) continue
        const adm = (state as Record<string, unknown>).adm as Record<string, unknown> | undefined
        if (!adm) continue
        if (adm.type === 'admission-nonce' && adm.forPeerId === String(myClientId)) {
          const nonce = adm.nonce as string
          const sig = await this.#identity.sign(nonce)
          this.#webrtc.awareness.setLocalStateField('adm', {
            type: 'admission-response',
            token: this.#token,
            signatureB64: bufferToBase64url(sig),
          })
        } else if (adm.type === 'admission-granted' && adm.forPeerId === String(myClientId)) {
          const wrappedRoomKey = adm.wrappedRoomKey as string | null
          if (wrappedRoomKey) {
            this.#sessionKey = await this.#identity.unwrapToSessionKey(wrappedRoomKey)
          }
          this.#status = 'connected'
          this.#emit('status', 'connected')
          this.#setupMessageObserver()
        }
      }
    }
    this.#webrtc.awareness.on('change', handler)
    this.#teardown.push(() => {
      this.#webrtc.awareness.off('change', handler)
    })
  }

  #setupOwnerSideHandlers(): void {
    const myClientId = this.#webrtc.awareness.clientID
    const handler = async () => {
      if (this.#role !== ROLES.OWNER) return
      const states = this.#webrtc.awareness.getStates()
      for (const [clientId, state] of states) {
        if (clientId === myClientId) continue
        const adm = (state as Record<string, unknown>).adm as Record<string, unknown> | undefined
        if (!adm) continue
        if (adm.type === 'admission-request') {
          const admToken = adm.token as string
          const signingPubKeyB64 = adm.signingPubKeyB64 as string
          const oaepPubKeyB64 = adm.oaepPubKeyB64 as string | null
          const iss = await Claim.peek(admToken, 'iss')
          const issuerKeyB64 = this.#state.getIssuerSigningPublicKey(iss)
          if (!issuerKeyB64) return
          try {
            const { nonce } = await this.#protocol.requestAdmission(admToken, issuerKeyB64)
            this.#webrtc.awareness.setLocalStateField('adm', {
              type: 'admission-nonce',
              forPeerId: String(clientId),
              nonce,
            })
            this.#pendingAdmission.set(String(clientId), {
              token: admToken,
              signingPubKeyB64,
              oaepPubKeyB64,
            })
          } catch {
            /* invalid token, ignore */
          }
        } else if (adm.type === 'admission-response') {
          const admToken = adm.token as string
          const signatureB64 = adm.signatureB64 as string
          const pending = this.#pendingAdmission.get(String(clientId))
          if (!pending || pending.token !== admToken) return
          const iss = await Claim.peek(admToken, 'iss')
          const issuerKeyB64 = this.#state.getIssuerSigningPublicKey(iss)
          if (!issuerKeyB64) return // unknown issuer at response time, ignore
          const knownPubKey = this.#state.getInviteSigningPublicKey(
            await Claim.peek(admToken, 'jti'),
          )
          try {
            await this.#protocol.respondToChallenge(
              admToken,
              issuerKeyB64,
              pending.signingPubKeyB64,
              signatureB64,
              knownPubKey,
            )
            const claim = await Claim.verify(
              admToken,
              await Identity.importSigningPublicKey(issuerKeyB64),
            )
            this.#state.addPeer(claim, pending.signingPubKeyB64)
            this.#emit('peer-admitted', {
              peerId: String(clientId),
              role: claim.role,
              admittedAt: Date.now(),
            })
            let wrappedRoomKey: string | null = null
            if (claim.role === ROLES.MODERATOR && pending.oaepPubKeyB64 && this.#sessionKey) {
              const oaepPubKey = await Identity.importOaepPublicKey(pending.oaepPubKeyB64)
              wrappedRoomKey = await this.#sessionKey.wrapFor(oaepPubKey)
            }
            this.#webrtc.awareness.setLocalStateField('adm', {
              type: 'admission-granted',
              forPeerId: String(clientId),
              wrappedRoomKey,
            })
            this.#pendingAdmission.delete(String(clientId))
          } catch {
            /* invalid signature, ignore */
          }
        }
      }
    }
    this.#webrtc.awareness.on('change', handler)
    this.#teardown.push(() => {
      this.#webrtc.awareness.off('change', handler)
    })
  }

  #setupMessageObserver(): void {
    if (this.#messageObserverAttached) return
    this.#messageObserverAttached = true
    const cleanup = this.#state.observeMessages((entries) => {
      for (const entry of entries) {
        this.#decryptAndCacheMessage(entry)
          .then((msg) => {
            if (msg) this.#emit('new-message', msg)
          })
          .catch(() => {
            /* ignore decryption errors */
          })
      }
    })
    this.#teardown.push(cleanup)
  }

  async #decryptAndCacheMessage(entry: EncryptedChatEntry): Promise<DecryptedMessage | null> {
    if (!this.#sessionKey) return null
    const text = await this.#sessionKey.decrypt(entry)
    const msg: DecryptedMessage = {
      id: entry.id,
      peerId: entry.senderId,
      text,
      sentAt: entry.sentAt,
    }
    this.#messageCache.push(msg)
    return msg
  }

  #emit(event: string, data: unknown): void {
    const handlers = this.#emitter.get(event)
    if (handlers) for (const h of handlers) h(data)
  }

  // ── Public getters ──────────────────────────────────────────────────────────

  get id(): string {
    return this.#id
  }

  get peerId(): string {
    return this.#identity.id
  }

  get role(): Role {
    return this.#role
  }

  get status(): RoomStatus {
    return this.#status
  }

  get token(): string {
    return this.#token
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.#emitter.has(event)) this.#emitter.set(event, new Set())
    this.#emitter.get(event)!.add(handler)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.#emitter.get(event)?.delete(handler)
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async createInvite(role: 'moderator' | 'guest'): Promise<string> {
    // Both owner and moderator can mint invite JWTs.
    // Moderator-issued JWTs are accepted by the owner because the moderator's
    // signing key is in trustedSigningKeys after their own admission.
    // The spec (docs/plans/ratifyd-adr.md) explicitly authorizes this.
    if (this.#role === ROLES.GUEST) throw new AuthError('Guests cannot create invites')
    if (role === ROLES.GUEST) {
      const admitted = this.#state.listAdmittedPeers()
      const hasGuest = admitted.some((p) => p.role === ROLES.GUEST)
      if (hasGuest) throw new AuthError('A guest is already admitted to this session')
    }
    const claim = await this.#identity.mintClaim(
      this.#identity.id,
      this.#id,
      role,
      this.#identity.id,
    )
    return `#token=${claim.raw}`
  }

  bindEditor(editor: monaco.editor.IStandaloneCodeEditor): () => void {
    const binding = new MonacoBinding(
      this.#state.editorContent,
      editor.getModel()!,
      new Set([editor]),
      this.#webrtc.awareness,
    )
    return () => binding.destroy()
  }

  updateEditorLanguage(language: string): void {
    this.#state.editorLanguage.set('lang', language)
  }

  bindExcalidraw(api: ExcalidrawAPI): {
    onChange: (elements: readonly ExcalidrawElement[]) => void
    destroy: () => void
  } {
    const observer = () => {
      const raw = this.#state.excalidrawState.get('elements') ?? '[]'
      api.updateScene({ elements: JSON.parse(raw) })
    }
    this.#state.excalidrawState.observe(observer)

    const onChange = (elements: readonly ExcalidrawElement[]) => {
      this.#state.excalidrawState.set('elements', JSON.stringify(elements))
    }

    return {
      onChange,
      destroy: () => this.#state.excalidrawState.unobserve(observer),
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (this.#role === ROLES.GUEST) throw new AuthError('Guests cannot send messages')
    if (!this.#sessionKey) throw new RoomError('No room key available')
    const blob = await this.#sessionKey.encrypt(text)
    const entry: EncryptedChatEntry = {
      id: crypto.randomUUID(),
      senderId: this.#identity.id,
      senderLabel: this.#identity.label,
      sentAt: Date.now(),
      iv: blob.iv,
      ciphertext: blob.ciphertext,
    }
    this.#state.appendMessage(entry)
  }

  async getMessages(options?: { before?: number; limit?: number }): Promise<DecryptedMessage[]> {
    if (this.#role === ROLES.GUEST) throw new AuthError('Guests cannot read messages')
    if (!this.#sessionKey) throw new RoomError('No room key available')
    const encrypted = this.#state.getEncryptedMessages(options)
    const decrypted = await Promise.all(
      encrypted.map((e) =>
        this.#sessionKey!.decrypt(e).then(
          (text) =>
            ({
              id: e.id,
              peerId: e.senderId,
              text,
              sentAt: e.sentAt,
            }) as DecryptedMessage,
        ),
      ),
    )
    return decrypted
  }

  async updateInstructions(text: string): Promise<void> {
    if (this.#role === ROLES.GUEST) throw new AuthError('Guests cannot update instructions')
    if (!this.#sessionKey) throw new RoomError('No room key available')
    const blob = await this.#sessionKey.encrypt(text)
    this.#state.setNotes(blob)
    this.#emit('instructions', text)
  }

  async getInstructions(): Promise<string> {
    if (this.#role === ROLES.GUEST) throw new AuthError('Guests cannot read instructions')
    const blob = this.#state.getNotes()
    if (!blob) return ''
    if (!this.#sessionKey) throw new RoomError('No room key available')
    return this.#sessionKey.decrypt(blob)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    for (const cleanup of this.#teardown) cleanup()
    this.#teardown = []
    this.#protocol.destroy()
    this.#webrtc.destroy()
    this.#indexeddb.destroy()
    this.#doc.destroy()
    this.#emitter.clear()
  }
}
