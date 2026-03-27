import * as Y from 'yjs'
import { ROLES } from '../constants'
import type { Claim } from './Claim'

export interface AdmittedPeer {
  role: string
  admittedAt: number
}

export interface EncryptedChatEntry {
  id: string
  senderId: string
  senderLabel: string
  sentAt: number
  iv: string
  ciphertext: string
}

/**
 * All shared Yjs types for a Ratifyd session.
 *
 * trustedSigningKeys  Y.Map   { peerId → base64 signingPubKey }
 * burnedJTIs          Y.Map   { jti → base64 signingPubKey }   ← Y.Map, NOT Array
 * admittedPeers       Y.Map   { peerId → AdmittedPeer }
 * moderatorChat       Y.Array<EncryptedChatEntry>
 * moderatorNotes      Y.Map   { iv: string, ciphertext: string }
 * editorContent       Y.Text  (Monaco — NOT encrypted)
 * editorLanguage      Y.Map   { lang: string }
 * excalidrawState     Y.Map   { elements: string }  (NOT encrypted)
 *
 * moderatorChat and moderatorNotes contain ONLY AES-GCM ciphertext.
 * Plaintext never touches the Yjs document. Guests see only encrypted blobs.
 */
export class State {
  #doc: Y.Doc
  #trustedSigningKeys: Y.Map<string>
  #burnedJTIs: Y.Map<string>
  #admittedPeers: Y.Map<AdmittedPeer>
  #moderatorChat: Y.Array<EncryptedChatEntry>
  #moderatorNotes: Y.Map<string>
  #editorContent: Y.Text
  #editorLanguage: Y.Map<string>
  #excalidrawState: Y.Map<string>

  constructor(doc: Y.Doc) {
    this.#doc = doc
    this.#trustedSigningKeys = doc.getMap<string>('trustedSigningKeys')
    this.#burnedJTIs = doc.getMap<string>('burnedJTIs')
    this.#admittedPeers = doc.getMap<AdmittedPeer>('admittedPeers')
    this.#moderatorChat = doc.getArray<EncryptedChatEntry>('moderatorChat')
    this.#moderatorNotes = doc.getMap<string>('moderatorNotes')
    this.#editorContent = doc.getText('editorContent')
    this.#editorLanguage = doc.getMap<string>('editorLanguage')
    this.#excalidrawState = doc.getMap<string>('excalidrawState')
  }

  // DESIGN: live Y.Text reference required for MonacoBinding — Read/Write by Room.bindEditor()
  get editorContent(): Y.Text {
    return this.#editorContent
  }

  // DESIGN: live Y.Map reference required for Room.updateEditorLanguage()
  get editorLanguage(): Y.Map<string> {
    return this.#editorLanguage
  }

  // DESIGN: live Y.Map reference required for Room.bindExcalidraw() — observe() and set() called by Room
  get excalidrawState(): Y.Map<string> {
    return this.#excalidrawState
  }

  // ── Peer state ──────────────────────────────────────────────────────────────

  addPeer(claim: Claim, signingPublicKey: string): void {
    if (!this.isJtiBurned(claim.jti)) this.#burnedJTIs.set(claim.jti, signingPublicKey)
    if (!this.#admittedPeers.has(claim.sub))
      this.#admittedPeers.set(claim.sub, { role: claim.role, admittedAt: Date.now() })
    if (claim.role === ROLES.OWNER || claim.role === ROLES.MODERATOR)
      this.#trustedSigningKeys.set(claim.sub, signingPublicKey)
  }

  getIssuerSigningPublicKey(peerId: string): string | null {
    return this.#trustedSigningKeys.get(peerId) || null
  }

  getInviteSigningPublicKey(jti: string): string | null {
    return this.#burnedJTIs.get(jti) || null
  }

  isJtiBurned(jti: string): boolean {
    return this.#burnedJTIs.has(jti)
  }

  listAdmittedPeers(): Array<{ peerId: string; role: string; admittedAt: number }> {
    return Array.from(this.#admittedPeers.entries()).map(([peerId, peer]) => ({
      peerId,
      ...peer,
    }))
  }

  observePeers(cb: (peerId: string, peer: AdmittedPeer | null) => void): () => void {
    const handler = (event: Y.YMapEvent<AdmittedPeer>) => {
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'delete') {
          cb(key, null)
        } else {
          const peer = this.#admittedPeers.get(key)
          if (peer) cb(key, peer)
        }
      })
    }
    this.#admittedPeers.observe(handler)
    return () => this.#admittedPeers.unobserve(handler)
  }

  // ── Encrypted chat ──────────────────────────────────────────────────────────

  appendMessage(entry: EncryptedChatEntry): void {
    this.#moderatorChat.push([entry])
  }

  getEncryptedMessages(options?: { before?: number; limit?: number }): EncryptedChatEntry[] {
    const limit = options?.limit ?? 30
    const entries = this.#moderatorChat.toArray()
    const filtered = options?.before ? entries.filter((e) => e.sentAt < options.before!) : entries
    return filtered.slice(-limit)
  }

  observeMessages(cb: (newEntries: EncryptedChatEntry[]) => void): () => void {
    const handler = (event: Y.YArrayEvent<EncryptedChatEntry>) => {
      const added: EncryptedChatEntry[] = []
      event.changes.delta.forEach((delta) => {
        if (delta.insert) added.push(...(delta.insert as EncryptedChatEntry[]))
      })
      if (added.length > 0) cb(added)
    }
    this.#moderatorChat.observe(handler)
    return () => this.#moderatorChat.unobserve(handler)
  }

  // ── Encrypted notes ─────────────────────────────────────────────────────────

  setNotes(blob: { iv: string; ciphertext: string }): void {
    this.#doc.transact(() => {
      this.#moderatorNotes.set('iv', blob.iv)
      this.#moderatorNotes.set('ciphertext', blob.ciphertext)
    })
  }

  getNotes(): { iv: string; ciphertext: string } | null {
    const iv = this.#moderatorNotes.get('iv')
    const ciphertext = this.#moderatorNotes.get('ciphertext')
    return iv && ciphertext ? { iv, ciphertext } : null
  }

  observeNotes(cb: (blob: { iv: string; ciphertext: string } | null) => void): () => void {
    const handler = () => cb(this.getNotes())
    this.#moderatorNotes.observe(handler)
    return () => this.#moderatorNotes.unobserve(handler)
  }
}
