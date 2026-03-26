import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Y from 'yjs'
import { State } from './State'
import { Identity } from './Identity'
import { ROLES } from '../constants'

// ── Constructor ───────────────────────────────────────────────────────────────

describe('State constructor', () => {
  it('accepts an externally provided Y.Doc', () => {
    const doc = new Y.Doc()
    const state = new State(doc)
    expect(state).toBeInstanceOf(State)
    doc.destroy()
  })

  it('two State instances sharing the same Y.Doc see the same mutations', async () => {
    const doc = new Y.Doc()
    const stateA = new State(doc)
    const stateB = new State(doc)
    const roomId = crypto.randomUUID()

    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)

    stateA.addPeer(claim, pubB64)
    expect(stateB.getIssuerSigningPublicKey(identity.id)).toBe(pubB64)
    doc.destroy()
  })
})

// ── UI-binding getters ─────────────────────────────────────────────────────────

describe('State UI-binding getters return correct Y types', () => {
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('editorContent is a Y.Text', () => {
    expect(state.editorContent).toBeInstanceOf(Y.Text)
  })

  it('editorLanguage is a Y.Map<string>', () => {
    expect(state.editorLanguage).toBeInstanceOf(Y.Map)
  })

  it('excalidrawState is a Y.Map<string>', () => {
    expect(state.excalidrawState).toBeInstanceOf(Y.Map)
  })

  it('getters return the same instance on repeated access (Yjs identity)', () => {
    expect(state.editorContent).toBe(state.editorContent)
    expect(state.editorLanguage).toBe(state.editorLanguage)
    expect(state.excalidrawState).toBe(state.excalidrawState)
  })
})

// ── addPeer ───────────────────────────────────────────────────────────────────

describe('State.addPeer', () => {
  const roomId = crypto.randomUUID()
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('burns the JTI so isJtiBurned returns true', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    expect(state.isJtiBurned(claim.jti)).toBe(true)
  })

  it('stores invite signing public key retrievable via getInviteSigningPublicKey', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    expect(state.getInviteSigningPublicKey(claim.jti)).toBe(pubB64)
  })

  it('adds the peer to listAdmittedPeers with correct role and admittedAt timestamp', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    const peers = state.listAdmittedPeers()
    expect(peers).toHaveLength(1)
    expect(peers[0].peerId).toBe(identity.id)
    expect(peers[0].role).toBe(ROLES.OWNER)
    expect(typeof peers[0].admittedAt).toBe('number')
    expect(peers[0].admittedAt).toBeGreaterThan(0)
  })

  it('adds owner to trustedSigningKeys (getIssuerSigningPublicKey returns key)', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    expect(state.getIssuerSigningPublicKey(identity.id)).toBe(pubB64)
  })

  it('adds moderator to trustedSigningKeys', async () => {
    const issuer = await Identity.create()
    const moderator = await Identity.create()
    const modPubB64 = await moderator.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(moderator.id, roomId, ROLES.MODERATOR, issuer.id)
    state.addPeer(claim, modPubB64)
    expect(state.getIssuerSigningPublicKey(moderator.id)).toBe(modPubB64)
  })

  it('does NOT add guest to trustedSigningKeys', async () => {
    const issuer = await Identity.create()
    const guest = await Identity.create()
    const guestPubB64 = await guest.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(guest.id, roomId, ROLES.GUEST, issuer.id)
    state.addPeer(claim, guestPubB64)
    expect(state.getIssuerSigningPublicKey(guest.id)).toBeNull()
  })

  it('is idempotent — calling addPeer twice does not create duplicates', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    state.addPeer(claim, pubB64)
    expect(state.listAdmittedPeers()).toHaveLength(1)
    expect(state.isJtiBurned(claim.jti)).toBe(true)
    expect(state.getIssuerSigningPublicKey(identity.id)).toBe(pubB64)
  })
})

// ── isJtiBurned ───────────────────────────────────────────────────────────────

describe('State.isJtiBurned', () => {
  const roomId = crypto.randomUUID()
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('returns false for an unknown JTI', () => {
    expect(state.isJtiBurned('unknown-jti')).toBe(false)
  })

  it('returns true after a JTI has been added via addPeer', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    expect(state.isJtiBurned(claim.jti)).toBe(true)
  })

  it('returns false for a different JTI that was not burned', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    expect(state.isJtiBurned('some-other-jti')).toBe(false)
  })
})

// ── getIssuerSigningPublicKey ─────────────────────────────────────────────────

describe('State.getIssuerSigningPublicKey', () => {
  const roomId = crypto.randomUUID()
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('returns null for an unknown peer', () => {
    expect(state.getIssuerSigningPublicKey('unknown-peer')).toBeNull()
  })

  it('returns the signing public key after an owner is admitted', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    expect(state.getIssuerSigningPublicKey(identity.id)).toBe(pubB64)
  })

  it('returns null for a guest (guests not in trustedSigningKeys)', async () => {
    const issuer = await Identity.create()
    const guest = await Identity.create()
    const guestPubB64 = await guest.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(guest.id, roomId, ROLES.GUEST, issuer.id)
    state.addPeer(claim, guestPubB64)
    expect(state.getIssuerSigningPublicKey(guest.id)).toBeNull()
  })
})

// ── getInviteSigningPublicKey ─────────────────────────────────────────────────

describe('State.getInviteSigningPublicKey', () => {
  const roomId = crypto.randomUUID()
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('returns null for an unknown JTI', () => {
    expect(state.getInviteSigningPublicKey('unknown-jti')).toBeNull()
  })

  it('returns the signing public key stored when the JTI was burned', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    expect(state.getInviteSigningPublicKey(claim.jti)).toBe(pubB64)
  })

  it('returns different keys for different JTIs', async () => {
    const issuer = await Identity.create()
    const peer1 = await Identity.create()
    const peer2 = await Identity.create()
    const pub1 = await peer1.getSigningPublicKeyB64()
    const pub2 = await peer2.getSigningPublicKeyB64()

    const claim1 = await issuer.mintClaim(peer1.id, roomId, ROLES.MODERATOR, issuer.id)
    const claim2 = await issuer.mintClaim(peer2.id, roomId, ROLES.MODERATOR, issuer.id)

    state.addPeer(claim1, pub1)
    state.addPeer(claim2, pub2)

    expect(state.getInviteSigningPublicKey(claim1.jti)).toBe(pub1)
    expect(state.getInviteSigningPublicKey(claim2.jti)).toBe(pub2)
  })
})

// ── listAdmittedPeers ─────────────────────────────────────────────────────────

describe('State.listAdmittedPeers', () => {
  const roomId = crypto.randomUUID()
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('returns empty array when no peers have been admitted', () => {
    expect(state.listAdmittedPeers()).toEqual([])
  })

  it('returns a snapshot array (not a live reference)', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    const snapshot = state.listAdmittedPeers()
    expect(Array.isArray(snapshot)).toBe(true)
    // Adding more peers should not affect the snapshot
    const identity2 = await Identity.create()
    const pub2 = await identity2.getSigningPublicKeyB64()
    const claim2 = await identity2.mintClaim(identity2.id, roomId, ROLES.MODERATOR, identity.id)
    state.addPeer(claim2, pub2)
    expect(snapshot).toHaveLength(1)
  })

  it('includes peerId, role, and admittedAt for each entry', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)
    const [entry] = state.listAdmittedPeers()
    expect(entry).toHaveProperty('peerId', identity.id)
    expect(entry).toHaveProperty('role', ROLES.OWNER)
    expect(entry).toHaveProperty('admittedAt')
    expect(typeof entry.admittedAt).toBe('number')
  })
})

// ── observePeers ──────────────────────────────────────────────────────────────

describe('State.observePeers', () => {
  const roomId = crypto.randomUUID()
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('fires callback when a peer is added', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)

    const cb = vi.fn()
    const unobserve = state.observePeers(cb)
    state.addPeer(claim, pubB64)

    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith(identity.id, expect.objectContaining({ role: ROLES.OWNER }))
    unobserve()
  })

  it('returns an unobserve function that stops further callbacks', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)

    const cb = vi.fn()
    const unobserve = state.observePeers(cb)
    state.addPeer(claim, pubB64)
    unobserve()
    // This would trigger another event (second peer, different jti)
    const identity2 = await Identity.create()
    const pub2 = await identity2.getSigningPublicKeyB64()
    const claim3 = await identity2.mintClaim(identity2.id, roomId, ROLES.MODERATOR, identity.id)
    state.addPeer(claim3, pub2)

    // Should have fired only once (before unobserve)
    expect(cb).toHaveBeenCalledOnce()
  })
})

// ── appendMessage / getEncryptedMessages / observeMessages ────────────────────

describe('State chat operations', () => {
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  const makeEntry = (id: string): import('./State').EncryptedChatEntry => ({
    id,
    senderId: 'peer-1',
    senderLabel: 'Alice',
    iv: 'iv-data',
    ciphertext: 'cipher-data',
  })

  it('getEncryptedMessages returns empty array when no messages', () => {
    expect(state.getEncryptedMessages()).toEqual([])
  })

  it('appendMessage adds a message retrievable via getEncryptedMessages', () => {
    const entry = makeEntry('msg-1')
    state.appendMessage(entry)
    const messages = state.getEncryptedMessages()
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual(entry)
  })

  it('getEncryptedMessages respects limit option', () => {
    for (let i = 0; i < 50; i++) state.appendMessage(makeEntry(`msg-${i}`))
    const messages = state.getEncryptedMessages({ limit: 10 })
    expect(messages).toHaveLength(10)
    // Should return the last 10
    expect(messages[9].id).toBe('msg-49')
  })

  it('getEncryptedMessages respects before option (pagination)', () => {
    for (let i = 0; i < 50; i++) state.appendMessage(makeEntry(`msg-${i}`))
    const page1 = state.getEncryptedMessages({ limit: 10, before: 0 })
    const page2 = state.getEncryptedMessages({ limit: 10, before: 10 })
    expect(page1[9].id).toBe('msg-49')
    expect(page2[9].id).toBe('msg-39')
  })

  it('observeMessages fires callback with newly added entries', () => {
    const cb = vi.fn()
    const unobserve = state.observeMessages(cb)
    const entry = makeEntry('msg-obs-1')
    state.appendMessage(entry)
    expect(cb).toHaveBeenCalledOnce()
    expect(cb).toHaveBeenCalledWith([entry])
    unobserve()
  })

  it('observeMessages unobserve stops further callbacks', () => {
    const cb = vi.fn()
    const unobserve = state.observeMessages(cb)
    state.appendMessage(makeEntry('msg-a'))
    unobserve()
    state.appendMessage(makeEntry('msg-b'))
    expect(cb).toHaveBeenCalledOnce()
  })
})

// ── setNotes / getNotes / observeNotes ────────────────────────────────────────

describe('State notes operations', () => {
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  afterEach(() => {
    doc.destroy()
  })

  it('getNotes returns null when not set', () => {
    expect(state.getNotes()).toBeNull()
  })

  it('setNotes then getNotes returns the blob', () => {
    state.setNotes({ iv: 'test-iv', ciphertext: 'test-cipher' })
    expect(state.getNotes()).toEqual({ iv: 'test-iv', ciphertext: 'test-cipher' })
  })

  it('setNotes overwrites previous notes', () => {
    state.setNotes({ iv: 'iv-1', ciphertext: 'cipher-1' })
    state.setNotes({ iv: 'iv-2', ciphertext: 'cipher-2' })
    expect(state.getNotes()).toEqual({ iv: 'iv-2', ciphertext: 'cipher-2' })
  })

  it('observeNotes fires callback when notes are set', () => {
    const cb = vi.fn()
    const unobserve = state.observeNotes(cb)
    state.setNotes({ iv: 'iv-obs', ciphertext: 'cipher-obs' })
    expect(cb).toHaveBeenCalled()
    expect(cb).toHaveBeenCalledWith({ iv: 'iv-obs', ciphertext: 'cipher-obs' })
    unobserve()
  })

  it('observeNotes unobserve stops further callbacks', () => {
    const cb = vi.fn()
    const unobserve = state.observeNotes(cb)
    state.setNotes({ iv: 'iv-1', ciphertext: 'cipher-1' })
    unobserve()
    state.setNotes({ iv: 'iv-2', ciphertext: 'cipher-2' })
    expect(cb).toHaveBeenCalledOnce()
  })
})

// ── Yjs cross-doc sync ────────────────────────────────────────────────────────

describe('State Yjs cross-doc sync', () => {
  it('syncs trustedSigningKeys between two docs after addPeer', async () => {
    const roomId = crypto.randomUUID()
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update)
    })

    const state1 = new State(doc1)
    const state2 = new State(doc2)

    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state1.addPeer(claim, pubB64)

    expect(state2.getIssuerSigningPublicKey(identity.id)).toBe(pubB64)
    expect(state2.isJtiBurned(claim.jti)).toBe(true)

    doc1.destroy()
    doc2.destroy()
  })
})

// ── Round-trip: getIssuerSigningPublicKey → Identity.importSigningPublicKey ───

describe('State key round-trip', () => {
  it('stored signing public key can be re-imported as a CryptoKey', async () => {
    const roomId = crypto.randomUUID()
    const doc = new Y.Doc()
    const state = new State(doc)

    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    state.addPeer(claim, pubB64)

    const stored = state.getIssuerSigningPublicKey(identity.id)
    expect(stored).not.toBeNull()

    const importedKey = await Identity.importSigningPublicKey(stored!)
    expect(importedKey).toBeInstanceOf(CryptoKey)
    expect(importedKey.type).toBe('public')

    doc.destroy()
  })
})
