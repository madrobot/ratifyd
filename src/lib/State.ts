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
    this.#trustedSigningKeys = this.#doc.getMap<string>('trustedSigningKeys')
    this.#burnedJTIs = this.#doc.getMap<string>('burnedJTIs')
    this.#admittedPeers = this.#doc.getMap<AdmittedPeer>('admittedPeers')
    this.#moderatorChat = this.#doc.getArray<EncryptedChatEntry>('moderatorChat')
    this.#moderatorNotes = this.#doc.getMap<string>('moderatorNotes')
    this.#editorContent = this.#doc.getText('editorContent')
    this.#editorLanguage = this.#doc.getMap<string>('editorLanguage')
    this.#excalidrawState = this.#doc.getMap<string>('excalidrawState')
  }

  get doc(): Y.Doc {
    return this.#doc
  }

  get trustedSigningKeys(): Y.Map<string> {
    return this.#trustedSigningKeys
  }

  get burnedJTIs(): Y.Map<string> {
    return this.#burnedJTIs
  }

  get admittedPeers(): Y.Map<AdmittedPeer> {
    return this.#admittedPeers
  }

  get moderatorChat(): Y.Array<EncryptedChatEntry> {
    return this.#moderatorChat
  }

  get moderatorNotes(): Y.Map<string> {
    return this.#moderatorNotes
  }

  get editorContent(): Y.Text {
    return this.#editorContent
  }

  get editorLanguage(): Y.Map<string> {
    return this.#editorLanguage
  }

  get excalidrawState(): Y.Map<string> {
    return this.#excalidrawState
  }

  async addPeer(claim: Claim, signingPublicKey: string): Promise<void> {
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
}
