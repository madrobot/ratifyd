import * as Y from 'yjs'

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

export interface SharedTypes {
  trustedSigningKeys: Y.Map<string>
  burnedJTIs: Y.Map<string>
  admittedPeers: Y.Map<AdmittedPeer>
  moderatorChat: Y.Array<EncryptedChatEntry>
  moderatorNotes: Y.Map<string>
  editorContent: Y.Text
  editorLanguage: Y.Map<string>
  excalidrawState: Y.Map<string>
}

export function createYjsDoc(): Y.Doc {
  return new Y.Doc()
}

/** Always use this accessor — never call ydoc.getMap/getText directly in components. */
export function getSharedTypes(ydoc: Y.Doc): SharedTypes {
  return {
    trustedSigningKeys: ydoc.getMap<string>('trustedSigningKeys'),
    burnedJTIs: ydoc.getMap<string>('burnedJTIs'),
    admittedPeers: ydoc.getMap<AdmittedPeer>('admittedPeers'),
    moderatorChat: ydoc.getArray<EncryptedChatEntry>('moderatorChat'),
    moderatorNotes: ydoc.getMap<string>('moderatorNotes'),
    editorContent: ydoc.getText('editorContent'),
    editorLanguage: ydoc.getMap<string>('editorLanguage'),
    excalidrawState: ydoc.getMap<string>('excalidrawState'),
  }
}
