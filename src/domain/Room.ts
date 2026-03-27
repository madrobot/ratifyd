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
import { AdmissionCoordinator } from './AdmissionCoordinator'
import type { AdmissionCoordinatorCallbacks } from './AdmissionCoordinator'
import { AuthError } from './error/AuthError'
import { RoomError } from './error/RoomError'

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
  #coordinator: AdmissionCoordinator | null = null
  #destroyed = false
  #messageObserverAttached = false

  private constructor() {}

  static async create(): Promise<Room> {
    const room = new Room()
    const identity =
      (await Identity.load()) ?? (await (await Identity.create(undefined, true)).save())
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
    room.#coordinator = new AdmissionCoordinator(
      room.#webrtc.awareness,
      room.#protocol,
      room.#state,
      room.#identity,
      room.#buildCoordinatorCallbacks(() => {}),
    )
    room.#coordinator.setupOwnerHandlers(room.#sessionKey!)
    room.#teardown.push(() => room.#coordinator?.destroy())
    room.#setupMessageObserver()
    return room
  }

  static async join(token: string): Promise<Room> {
    const room = new Room()
    const roomId = await Claim.peek(token, 'room')
    const roleHint = await Claim.peek(token, 'role')
    const issHint = await Claim.peek(token, 'iss')
    const needsOaep = roleHint !== ROLES.GUEST
    const identity =
      (await Identity.load()) ?? (await (await Identity.create(undefined, needsOaep)).save())
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
      room.#coordinator = new AdmissionCoordinator(
        room.#webrtc.awareness,
        room.#protocol,
        room.#state,
        room.#identity,
        room.#buildCoordinatorCallbacks(() => {}),
      )
      room.#coordinator.setupOwnerHandlers(room.#sessionKey!)
      room.#teardown.push(() => room.#coordinator?.destroy())
      room.#setupMessageObserver()
      room.#status = 'connected'
    } else {
      room.#coordinator = new AdmissionCoordinator(
        room.#webrtc.awareness,
        room.#protocol,
        room.#state,
        room.#identity,
        room.#buildCoordinatorCallbacks((sk) => {
          if (sk) room.#sessionKey = sk
          room.#setupMessageObserver()
        }),
      )
      // Moderators can also admit other peers, so they get owner handlers too.
      // sessionKey is null here because the peer doesn't have it yet at admission time.
      room.#coordinator.setupOwnerHandlers(null)
      room.#coordinator.setupPeerHandlers(token)
      room.#teardown.push(() => room.#coordinator?.destroy())
      room.#setupPeerLeftListener()
      const ownerOnline = [...room.#webrtc.awareness.getStates().values()].some(
        (s) => (s as Record<string, unknown>)['role'] === ROLES.OWNER,
      )
      if (ownerOnline) {
        room.#status = 'connecting'
        await room.#coordinator.sendAdmissionRequest(token)
      } else {
        room.#status = 'awaiting'
        room.#coordinator.setupAwaitingOwnerWatch(token)
      }
    }

    return room
  }

  // ── Private methods ──────────────────────────────────────────────────────────

  #buildCoordinatorCallbacks(
    onAdmitted: (sk: SessionKey | null) => void,
  ): AdmissionCoordinatorCallbacks {
    return {
      onAdmitted,
      onPeerAdmitted: (info) => this.#emit('peer-admitted', info),
      onStatusChange: (status) => {
        this.#status = status
        this.#emit('status', status)
      },
      onError: (err) => {
        this.#status = 'error'
        this.#emit('error', err)
      },
    }
  }

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
    // Merge into cache — avoid duplicates by id
    const cachedIds = new Set(this.#messageCache.map((m) => m.id))
    for (const msg of decrypted) {
      if (!cachedIds.has(msg.id)) {
        this.#messageCache.push(msg)
        cachedIds.add(msg.id)
      }
    }
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
