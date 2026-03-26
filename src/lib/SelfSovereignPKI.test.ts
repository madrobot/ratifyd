import { describe, it, expect, afterEach } from 'vitest'
import { SelfSovereignPKI } from './SelfSovereignPKI'
import { Identity } from './Identity'
import { AuthError } from './error/AuthError'
import { bufferToBase64url } from './helper'
import { ROLES } from '../constants'

// ── Constructor ───────────────────────────────────────────────────────────────

describe('SelfSovereignPKI constructor', () => {
  it('constructs with no arguments', () => {
    const pki = new SelfSovereignPKI()
    expect(pki).toBeInstanceOf(SelfSovereignPKI)
    pki.destroy()
  })

  it('creates independent instances that do not share admission state', async () => {
    const pki1 = new SelfSovereignPKI()
    const pki2 = new SelfSovereignPKI()

    const issuer = await Identity.create()
    const pubB64 = await issuer.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()
    const claim = await issuer.mintClaim(issuer.id, roomId, ROLES.OWNER, issuer.id)

    // Issue a nonce on pki1
    const { nonce } = await pki1.requestAdmission(claim.raw, pubB64)

    // pki2 should not have this nonce registered
    const signature = bufferToBase64url(await issuer.sign(nonce))
    await expect(
      pki2.respondToChallenge(claim.raw, pubB64, pubB64, signature, null),
    ).rejects.toThrow(AuthError)

    pki1.destroy()
    pki2.destroy()
  })
})

// ── requestAdmission ──────────────────────────────────────────────────────────

describe('SelfSovereignPKI.requestAdmission', () => {
  let pki: SelfSovereignPKI

  afterEach(() => {
    pki.destroy()
  })

  it('throws AuthError when issuerSigningPublicKey is null', async () => {
    pki = new SelfSovereignPKI()
    const identity = await Identity.create()
    const claim = await identity.mintClaim(identity.id, 'room-1', ROLES.OWNER, identity.id)
    await expect(pki.requestAdmission(claim.raw, null)).rejects.toThrow(AuthError)
  })

  it('throws AuthError with message "Unknown token issuer" when key is null', async () => {
    pki = new SelfSovereignPKI()
    const identity = await Identity.create()
    const claim = await identity.mintClaim(identity.id, 'room-1', ROLES.OWNER, identity.id)
    await expect(pki.requestAdmission(claim.raw, null)).rejects.toThrow('Unknown token issuer')
  })

  it('returns { nonce: string } for a valid owner token', async () => {
    pki = new SelfSovereignPKI()
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, 'room-1', ROLES.OWNER, identity.id)
    const result = await pki.requestAdmission(claim.raw, pubB64)
    expect(result).toHaveProperty('nonce')
    expect(typeof result.nonce).toBe('string')
    expect(result.nonce.length).toBeGreaterThan(0)
  })

  it('returns { nonce: string } for a valid moderator token', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-2', ROLES.MODERATOR, issuer.id)
    const result = await pki.requestAdmission(claim.raw, issuerPubB64)
    expect(typeof result.nonce).toBe('string')
    expect(result.nonce.length).toBeGreaterThan(0)
  })

  it('returns { nonce: string } for a valid guest token', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const guest = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(guest.id, 'room-3', ROLES.GUEST, issuer.id)
    const result = await pki.requestAdmission(claim.raw, issuerPubB64)
    expect(typeof result.nonce).toBe('string')
  })

  it('returns unique nonces for each call (no self-admit shortcut)', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const pubB64 = await issuer.getSigningPublicKeyB64()
    const claim1 = await issuer.mintClaim(peer.id, 'room-x', ROLES.MODERATOR, issuer.id)
    const claim2 = await issuer.mintClaim(peer.id, 'room-x', ROLES.MODERATOR, issuer.id)

    const r1 = await pki.requestAdmission(claim1.raw, pubB64)
    const r2 = await pki.requestAdmission(claim2.raw, pubB64)

    // Each call must produce a different nonce
    expect(r1.nonce).not.toBe(r2.nonce)
  })

  it('nonce is a 64-character hex string (32 bytes)', async () => {
    pki = new SelfSovereignPKI()
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, 'room-1', ROLES.OWNER, identity.id)
    const { nonce } = await pki.requestAdmission(claim.raw, pubB64)
    expect(nonce).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does NOT perform self-admit shortcut — always returns { nonce: string }', async () => {
    pki = new SelfSovereignPKI()
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    // Even when the issuer equals the subject (self-issued owner token), must return nonce
    const claim = await identity.mintClaim(identity.id, 'room-1', ROLES.OWNER, identity.id)
    const result = await pki.requestAdmission(claim.raw, pubB64)
    // Must be an object with nonce, NOT the boolean true
    expect(result).not.toBe(true)
    expect(typeof result).toBe('object')
    expect(result).toHaveProperty('nonce')
  })

  it('throws when issuerSigningPublicKey does not match the token signature', async () => {
    pki = new SelfSovereignPKI()
    const realIssuer = await Identity.create()
    const wrongIssuer = await Identity.create()
    const wrongPubB64 = await wrongIssuer.getSigningPublicKeyB64()
    const claim = await realIssuer.mintClaim(realIssuer.id, 'room-1', ROLES.OWNER, realIssuer.id)
    // Verify with the wrong key — should throw TokenError (wrapped as auth failure)
    await expect(pki.requestAdmission(claim.raw, wrongPubB64)).rejects.toThrow()
  })
})

// ── respondToChallenge ────────────────────────────────────────────────────────

describe('SelfSovereignPKI.respondToChallenge', () => {
  let pki: SelfSovereignPKI

  afterEach(() => {
    pki.destroy()
  })

  it('throws AuthError when issuerSigningPublicKey is null', async () => {
    pki = new SelfSovereignPKI()
    const identity = await Identity.create()
    const pubB64 = await identity.getSigningPublicKeyB64()
    const claim = await identity.mintClaim(identity.id, 'room-1', ROLES.OWNER, identity.id)

    await expect(pki.respondToChallenge(claim.raw, null, pubB64, 'sig', null)).rejects.toThrow(
      AuthError,
    )
  })

  it('throws AuthError when peerSigningPublicKey mismatches knownPeerSigningPublicKey', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const impostor = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const peerPubB64 = await peer.getSigningPublicKeyB64()
    const impostorPubB64 = await impostor.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-2', ROLES.MODERATOR, issuer.id)

    const { nonce } = await pki.requestAdmission(claim.raw, issuerPubB64)
    const sig = bufferToBase64url(await peer.sign(nonce))

    await expect(
      pki.respondToChallenge(claim.raw, issuerPubB64, impostorPubB64, sig, peerPubB64),
    ).rejects.toThrow(AuthError)
  })

  it('throws AuthError when nonce signature is invalid (wrong key)', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const attacker = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const peerPubB64 = await peer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-2', ROLES.MODERATOR, issuer.id)

    const { nonce } = await pki.requestAdmission(claim.raw, issuerPubB64)
    // Attacker signs the nonce with their own key
    const badSig = bufferToBase64url(await attacker.sign(nonce))

    await expect(
      pki.respondToChallenge(claim.raw, issuerPubB64, peerPubB64, badSig, null),
    ).rejects.toThrow(AuthError)
  })

  it('throws AuthError when nonce was never issued for this token', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const peerPubB64 = await peer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-3', ROLES.MODERATOR, issuer.id)

    // Do NOT call requestAdmission first — no nonce registered
    const fakeSig = bufferToBase64url(await peer.sign('some-random-nonce'))

    await expect(
      pki.respondToChallenge(claim.raw, issuerPubB64, peerPubB64, fakeSig, null),
    ).rejects.toThrow(AuthError)
  })

  it('returns true when nonce signature is valid', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const peerPubB64 = await peer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-4', ROLES.MODERATOR, issuer.id)

    const { nonce } = await pki.requestAdmission(claim.raw, issuerPubB64)
    const sig = bufferToBase64url(await peer.sign(nonce))

    const result = await pki.respondToChallenge(claim.raw, issuerPubB64, peerPubB64, sig, null)
    expect(result).toBe(true)
  })

  it('returns true when knownPeerSigningPublicKey matches peerSigningPublicKey', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const peerPubB64 = await peer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-5', ROLES.MODERATOR, issuer.id)

    const { nonce } = await pki.requestAdmission(claim.raw, issuerPubB64)
    const sig = bufferToBase64url(await peer.sign(nonce))

    // knownPeerSigningPublicKey matches peerSigningPublicKey — reconnect path
    const result = await pki.respondToChallenge(
      claim.raw,
      issuerPubB64,
      peerPubB64,
      sig,
      peerPubB64,
    )
    expect(result).toBe(true)
  })

  it('burns the nonce after successful verification — second call with same token rejects', async () => {
    pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const peerPubB64 = await peer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-replay', ROLES.MODERATOR, issuer.id)

    const { nonce } = await pki.requestAdmission(claim.raw, issuerPubB64)
    const sig = bufferToBase64url(await peer.sign(nonce))

    // First call succeeds
    await expect(
      pki.respondToChallenge(claim.raw, issuerPubB64, peerPubB64, sig, null),
    ).resolves.toBe(true)

    // Second call with the same token and signature must fail — nonce was burned
    await expect(
      pki.respondToChallenge(claim.raw, issuerPubB64, peerPubB64, sig, null),
    ).rejects.toThrow(AuthError)
  })

  it('full owner admission flow succeeds end-to-end', async () => {
    pki = new SelfSovereignPKI()
    const owner = await Identity.create()
    const ownerPubB64 = await owner.getSigningPublicKeyB64()
    const claim = await owner.mintClaim(owner.id, 'room-owner', ROLES.OWNER, owner.id)

    const { nonce } = await pki.requestAdmission(claim.raw, ownerPubB64)
    expect(typeof nonce).toBe('string')

    const sig = bufferToBase64url(await owner.sign(nonce))
    const result = await pki.respondToChallenge(claim.raw, ownerPubB64, ownerPubB64, sig, null)
    expect(result).toBe(true)
  })
})

// ── destroy ───────────────────────────────────────────────────────────────────

describe('SelfSovereignPKI.destroy', () => {
  it('calling destroy does not throw', () => {
    const pki = new SelfSovereignPKI()
    expect(() => pki.destroy()).not.toThrow()
  })

  it('after destroy, pending admission requests are cleared', async () => {
    const pki = new SelfSovereignPKI()
    const issuer = await Identity.create()
    const peer = await Identity.create()
    const issuerPubB64 = await issuer.getSigningPublicKeyB64()
    const peerPubB64 = await peer.getSigningPublicKeyB64()
    const claim = await issuer.mintClaim(peer.id, 'room-1', ROLES.MODERATOR, issuer.id)

    const { nonce } = await pki.requestAdmission(claim.raw, issuerPubB64)
    pki.destroy()

    const sig = bufferToBase64url(await peer.sign(nonce))
    // After destroy, no nonce should exist for this jti
    await expect(
      pki.respondToChallenge(claim.raw, issuerPubB64, peerPubB64, sig, null),
    ).rejects.toThrow('No nonce issued for this token')
  })
})
