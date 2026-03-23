import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { createYjsDoc, getSharedTypes } from './doc'

describe('createYjsDoc', () => {
  it('returns a Y.Doc instance', () => {
    const doc = createYjsDoc()
    expect(doc).toBeInstanceOf(Y.Doc)
    doc.destroy()
  })

  it('creates independent documents on each call', () => {
    const doc1 = createYjsDoc()
    const doc2 = createYjsDoc()
    expect(doc1).not.toBe(doc2)
    doc1.destroy()
    doc2.destroy()
  })
})

describe('getSharedTypes', () => {
  it('returns all expected shared type keys', () => {
    const doc = createYjsDoc()
    const shared = getSharedTypes(doc)

    expect(shared).toHaveProperty('trustedSigningKeys')
    expect(shared).toHaveProperty('burnedJTIs')
    expect(shared).toHaveProperty('admittedPeers')
    expect(shared).toHaveProperty('moderatorChat')
    expect(shared).toHaveProperty('moderatorNotes')
    expect(shared).toHaveProperty('editorContent')
    expect(shared).toHaveProperty('editorLanguage')
    expect(shared).toHaveProperty('excalidrawState')
    doc.destroy()
  })

  it('trustedSigningKeys is a Y.Map', () => {
    const doc = createYjsDoc()
    const { trustedSigningKeys } = getSharedTypes(doc)
    expect(trustedSigningKeys).toBeInstanceOf(Y.Map)
    doc.destroy()
  })

  it('burnedJTIs is a Y.Map', () => {
    const doc = createYjsDoc()
    const { burnedJTIs } = getSharedTypes(doc)
    expect(burnedJTIs).toBeInstanceOf(Y.Map)
    doc.destroy()
  })

  it('admittedPeers is a Y.Map', () => {
    const doc = createYjsDoc()
    const { admittedPeers } = getSharedTypes(doc)
    expect(admittedPeers).toBeInstanceOf(Y.Map)
    doc.destroy()
  })

  it('moderatorChat is a Y.Array', () => {
    const doc = createYjsDoc()
    const { moderatorChat } = getSharedTypes(doc)
    expect(moderatorChat).toBeInstanceOf(Y.Array)
    doc.destroy()
  })

  it('moderatorNotes is a Y.Map', () => {
    const doc = createYjsDoc()
    const { moderatorNotes } = getSharedTypes(doc)
    expect(moderatorNotes).toBeInstanceOf(Y.Map)
    doc.destroy()
  })

  it('editorContent is a Y.Text', () => {
    const doc = createYjsDoc()
    const { editorContent } = getSharedTypes(doc)
    expect(editorContent).toBeInstanceOf(Y.Text)
    doc.destroy()
  })

  it('editorLanguage is a Y.Map', () => {
    const doc = createYjsDoc()
    const { editorLanguage } = getSharedTypes(doc)
    expect(editorLanguage).toBeInstanceOf(Y.Map)
    doc.destroy()
  })

  it('excalidrawState is a Y.Map', () => {
    const doc = createYjsDoc()
    const { excalidrawState } = getSharedTypes(doc)
    expect(excalidrawState).toBeInstanceOf(Y.Map)
    doc.destroy()
  })

  it('returns the same underlying shared types on repeated calls (Yjs identity)', () => {
    const doc = createYjsDoc()
    const a = getSharedTypes(doc)
    const b = getSharedTypes(doc)
    // Yjs returns the same instance for the same name
    expect(a.trustedSigningKeys).toBe(b.trustedSigningKeys)
    expect(a.editorContent).toBe(b.editorContent)
    doc.destroy()
  })

  it('editorContent reflects text insertions', () => {
    const doc = createYjsDoc()
    const { editorContent } = getSharedTypes(doc)
    editorContent.insert(0, 'hello world')
    expect(editorContent.toString()).toBe('hello world')
    doc.destroy()
  })

  it('trustedSigningKeys stores and retrieves values', () => {
    const doc = createYjsDoc()
    const { trustedSigningKeys } = getSharedTypes(doc)
    trustedSigningKeys.set('peer-1', 'base64pubkey==')
    expect(trustedSigningKeys.get('peer-1')).toBe('base64pubkey==')
    doc.destroy()
  })

  it('admittedPeers stores AdmittedPeer objects', () => {
    const doc = createYjsDoc()
    const { admittedPeers } = getSharedTypes(doc)
    const peer = { role: 'moderator', admittedAt: 1234567890 }
    admittedPeers.set('peer-2', peer)
    expect(admittedPeers.get('peer-2')).toEqual(peer)
    doc.destroy()
  })

  it('moderatorChat supports push and length', () => {
    const doc = createYjsDoc()
    const { moderatorChat } = getSharedTypes(doc)
    const entry = {
      id: 'msg-1',
      senderId: 'peer-1',
      senderLabel: 'Alice',
      iv: 'iv123',
      ciphertext: 'enc-blob',
    }
    moderatorChat.push([entry])
    expect(moderatorChat.length).toBe(1)
    expect(moderatorChat.get(0)).toEqual(entry)
    doc.destroy()
  })

  it('burnedJTIs stores JTI → signingPubKey mappings', () => {
    const doc = createYjsDoc()
    const { burnedJTIs } = getSharedTypes(doc)
    burnedJTIs.set('jti-abc', 'pubkey-base64')
    expect(burnedJTIs.get('jti-abc')).toBe('pubkey-base64')
    expect(burnedJTIs.has('jti-abc')).toBe(true)
    expect(burnedJTIs.has('jti-xyz')).toBe(false)
    doc.destroy()
  })
})

describe('Yjs cross-doc sync (in-process)', () => {
  it('syncs editorContent between two docs via Y.applyUpdate', () => {
    const doc1 = createYjsDoc()
    const doc2 = createYjsDoc()

    // Forward all updates from doc1 → doc2
    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update)
    })

    const shared1 = getSharedTypes(doc1)
    shared1.editorContent.insert(0, 'synced text')

    const shared2 = getSharedTypes(doc2)
    expect(shared2.editorContent.toString()).toBe('synced text')

    doc1.destroy()
    doc2.destroy()
  })

  it('syncs trustedSigningKeys between two docs', () => {
    const doc1 = createYjsDoc()
    const doc2 = createYjsDoc()

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update)
    })

    const shared1 = getSharedTypes(doc1)
    shared1.trustedSigningKeys.set('peer-A', 'pubkeyA')

    const shared2 = getSharedTypes(doc2)
    expect(shared2.trustedSigningKeys.get('peer-A')).toBe('pubkeyA')

    doc1.destroy()
    doc2.destroy()
  })
})
