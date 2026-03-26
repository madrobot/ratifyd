import { describe, it, expect, beforeEach } from 'vitest'
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

  it('uses the exact Y.Doc passed in (same reference via getter)', () => {
    const doc = new Y.Doc()
    const state = new State(doc)
    expect(state.doc).toBe(doc)
    doc.destroy()
  })

  it('two State instances sharing the same Y.Doc see the same mutations', () => {
    const doc = new Y.Doc()
    const stateA = new State(doc)
    const stateB = new State(doc)
    stateA.trustedSigningKeys.set('peer-1', 'pubkey-A')
    expect(stateB.trustedSigningKeys.get('peer-1')).toBe('pubkey-A')
    doc.destroy()
  })
})

// ── Getters ───────────────────────────────────────────────────────────────────

describe('State getters return correct Y types', () => {
  let doc: Y.Doc
  let state: State

  beforeEach(() => {
    doc = new Y.Doc()
    state = new State(doc)
  })

  it('doc returns the Y.Doc instance', () => {
    expect(state.doc).toBeInstanceOf(Y.Doc)
  })

  it('trustedSigningKeys is a Y.Map<string>', () => {
    expect(state.trustedSigningKeys).toBeInstanceOf(Y.Map)
  })

  it('burnedJTIs is a Y.Map<string>', () => {
    expect(state.burnedJTIs).toBeInstanceOf(Y.Map)
  })

  it('admittedPeers is a Y.Map', () => {
    expect(state.admittedPeers).toBeInstanceOf(Y.Map)
  })

  it('moderatorChat is a Y.Array', () => {
    expect(state.moderatorChat).toBeInstanceOf(Y.Array)
  })

  it('moderatorNotes is a Y.Map<string>', () => {
    expect(state.moderatorNotes).toBeInstanceOf(Y.Map)
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
    expect(state.trustedSigningKeys).toBe(state.trustedSigningKeys)
    expect(state.editorContent).toBe(state.editorContent)
    expect(state.admittedPeers).toBe(state.admittedPeers)
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

  it('adds the JTI to burnedJTIs with the signing public key as the value', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
    expect(state.burnedJTIs.get(claim.jti)).toBe(pubB64)
  })

  it('adds the peer to admittedPeers with correct role and admittedAt timestamp', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
    const record = state.admittedPeers.get(identity.id)
    expect(record?.role).toBe(ROLES.OWNER)
    expect(typeof record?.admittedAt).toBe('number')
    expect(record!.admittedAt).toBeGreaterThan(0)
  })

  it('adds owner to trustedSigningKeys', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
    expect(state.trustedSigningKeys.get(identity.id)).toBe(pubB64)
  })

  it('adds moderator to trustedSigningKeys', async () => {
    const issuer = await Identity.create()
    const moderator = await Identity.create()
    const modPubB64 = await moderator.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(moderator.id, roomId, ROLES.MODERATOR, issuer.id)
    await state.addPeer(claim, modPubB64)
    expect(state.trustedSigningKeys.get(moderator.id)).toBe(modPubB64)
  })

  it('does NOT add guest to trustedSigningKeys', async () => {
    const issuer = await Identity.create()
    const guest = await Identity.create()
    const guestPubB64 = await guest.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(guest.id, roomId, ROLES.GUEST, issuer.id)
    await state.addPeer(claim, guestPubB64)
    expect(state.trustedSigningKeys.has(guest.id)).toBe(false)
  })

  it('is idempotent — calling addPeer twice does not create duplicates', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
    await state.addPeer(claim, pubB64)
    expect(state.burnedJTIs.size).toBe(1)
    expect(state.admittedPeers.size).toBe(1)
    expect(state.trustedSigningKeys.size).toBe(1)
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

  it('returns false for an unknown JTI', () => {
    expect(state.isJtiBurned('unknown-jti')).toBe(false)
  })

  it('returns true after a JTI has been added via addPeer', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
    expect(state.isJtiBurned(claim.jti)).toBe(true)
  })

  it('returns false for a different JTI that was not burned', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
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

  it('returns null for an unknown peer', () => {
    expect(state.getIssuerSigningPublicKey('unknown-peer')).toBeNull()
  })

  it('returns the signing public key after an owner is admitted', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
    expect(state.getIssuerSigningPublicKey(identity.id)).toBe(pubB64)
  })

  it('returns null for a guest (guests not in trustedSigningKeys)', async () => {
    const issuer = await Identity.create()
    const guest = await Identity.create()
    const guestPubB64 = await guest.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(guest.id, roomId, ROLES.GUEST, issuer.id)
    await state.addPeer(claim, guestPubB64)
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

  it('returns null for an unknown JTI', () => {
    expect(state.getInviteSigningPublicKey('unknown-jti')).toBeNull()
  })

  it('returns the signing public key stored when the JTI was burned', async () => {
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, roomId, ROLES.OWNER, identity.id)
    await state.addPeer(claim, pubB64)
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

    await state.addPeer(claim1, pub1)
    await state.addPeer(claim2, pub2)

    expect(state.getInviteSigningPublicKey(claim1.jti)).toBe(pub1)
    expect(state.getInviteSigningPublicKey(claim2.jti)).toBe(pub2)
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
    await state1.addPeer(claim, pubB64)

    expect(state2.trustedSigningKeys.get(identity.id)).toBe(pubB64)
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
    await state.addPeer(claim, pubB64)

    const stored = state.getIssuerSigningPublicKey(identity.id)
    expect(stored).not.toBeNull()

    const importedKey = await Identity.importSigningPublicKey(stored!)
    expect(importedKey).toBeInstanceOf(CryptoKey)
    expect(importedKey.type).toBe('public')

    doc.destroy()
  })
})
