import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { getSharedTypes, type SharedTypes } from '../yjs/doc'
import {
  generateSigningKeyPair,
  exportSigningPublicKey,
  signBytes,
  bufferToBase64url,
} from '../crypto/signing'
import { generateOaepKeyPair, exportOaepPublicKey } from '../crypto/oaep'
import { generateRoomKey, exportRoomKey } from '../crypto/roomKey'
import { mintJWT } from '../jwt'
import { ROLES } from '../../constants'
import type { JWTPayload } from '../../constants'
import { isOwnerSelfAdmit, ownerSelfAdmit, evaluateAdmission, issueNonce } from './index'
import { STORAGE_KEYS } from '../../constants'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeShared(): SharedTypes {
  const ydoc = new Y.Doc()
  return getSharedTypes(ydoc)
}

async function makeOwnerSetup() {
  const ownerId = crypto.randomUUID()
  const roomId = crypto.randomUUID()
  const sigKP = await generateSigningKeyPair()
  const sigPubB64 = await exportSigningPublicKey(sigKP.publicKey)
  const roomKey = await generateRoomKey()
  return { ownerId, roomId, sigKP, sigPubB64, roomKey }
}

async function makeModeratorSetup() {
  const modId = crypto.randomUUID()
  const sigKP = await generateSigningKeyPair()
  const sigPubB64 = await exportSigningPublicKey(sigKP.publicKey)
  const oaepKP = await generateOaepKeyPair()
  const oaepPubB64 = await exportOaepPublicKey(oaepKP.publicKey)
  return { modId, sigKP, sigPubB64, oaepKP, oaepPubB64 }
}

async function makeGuestSetup() {
  const guestId = crypto.randomUUID()
  const sigKP = await generateSigningKeyPair()
  const sigPubB64 = await exportSigningPublicKey(sigKP.publicKey)
  return { guestId, sigKP, sigPubB64 }
}

// ── isOwnerSelfAdmit ──────────────────────────────────────────────────────────

describe('isOwnerSelfAdmit', () => {
  const basePayload: JWTPayload = {
    room: 'room-1',
    role: ROLES.OWNER,
    iss: 'owner-123',
    jti: 'jti-abc',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }

  it('returns true when all conditions are met', () => {
    expect(isOwnerSelfAdmit(basePayload, 'owner-123', false)).toBe(true)
  })

  it('returns false when role is not owner', () => {
    expect(isOwnerSelfAdmit({ ...basePayload, role: ROLES.MODERATOR }, 'owner-123', false)).toBe(
      false,
    )
    expect(isOwnerSelfAdmit({ ...basePayload, role: ROLES.GUEST }, 'owner-123', false)).toBe(false)
  })

  it('returns false when localPeerId is null', () => {
    expect(isOwnerSelfAdmit(basePayload, null, false)).toBe(false)
  })

  it('returns false when iss does not match localPeerId', () => {
    expect(isOwnerSelfAdmit(basePayload, 'different-peer', false)).toBe(false)
  })

  it('returns false when other peers are connected (moderator cannot self-admit)', () => {
    expect(isOwnerSelfAdmit(basePayload, 'owner-123', true)).toBe(false)
  })
})

// ── ownerSelfAdmit ────────────────────────────────────────────────────────────

describe('ownerSelfAdmit', () => {
  const ownerId = 'owner-abc'
  const sigPubKeyB64 = 'base64-sig-pub'
  const payload: JWTPayload = {
    room: 'room-1',
    role: ROLES.OWNER,
    iss: ownerId,
    jti: 'jti-xyz',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }

  it('adds jti to burnedJTIs', () => {
    const shared = makeShared()
    ownerSelfAdmit(payload, sigPubKeyB64, ownerId, shared)
    expect(shared.burnedJTIs.get(payload.jti)).toBe(sigPubKeyB64)
  })

  it('adds owner to trustedSigningKeys', () => {
    const shared = makeShared()
    ownerSelfAdmit(payload, sigPubKeyB64, ownerId, shared)
    expect(shared.trustedSigningKeys.get(ownerId)).toBe(sigPubKeyB64)
  })

  it('adds owner to admittedPeers with role=owner', () => {
    const shared = makeShared()
    ownerSelfAdmit(payload, sigPubKeyB64, ownerId, shared)
    const record = shared.admittedPeers.get(ownerId)
    expect(record?.role).toBe(ROLES.OWNER)
    expect(typeof record?.admittedAt).toBe('number')
  })

  it('is idempotent — safe to call multiple times', () => {
    const shared = makeShared()
    ownerSelfAdmit(payload, sigPubKeyB64, ownerId, shared)
    ownerSelfAdmit(payload, sigPubKeyB64, ownerId, shared)
    expect(shared.burnedJTIs.size).toBe(1)
    expect(shared.trustedSigningKeys.size).toBe(1)
    expect(shared.admittedPeers.size).toBe(1)
  })
})

// ── issueNonce ─────────────────────────────────────────────────────────────────

describe('issueNonce', () => {
  it('returns a non-empty string', () => {
    const nonce = issueNonce()
    expect(typeof nonce).toBe('string')
    expect(nonce.length).toBeGreaterThan(0)
  })

  it('returns unique nonces on each call', () => {
    const n1 = issueNonce()
    const n2 = issueNonce()
    expect(n1).not.toBe(n2)
  })

  it('returns a 64-character hex string (32 bytes)', () => {
    const nonce = issueNonce()
    expect(nonce).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ── evaluateAdmission ─────────────────────────────────────────────────────────

describe('evaluateAdmission', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  async function setupOwnerShared(
    ownerId: string,
    sigPubB64: string,
    roomId: string,
    roomKey: CryptoKey,
  ) {
    const shared = makeShared()
    const jti = crypto.randomUUID()
    shared.trustedSigningKeys.set(ownerId, sigPubB64)
    // Save room key in localStorage so evaluateAdmission can load it
    localStorage.setItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`, await exportRoomKey(roomKey))
    return { shared, jti }
  }

  it('fails with WRONG_ROOM when token room does not match roomId', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT(
      { room: 'different-room', role: ROLES.MODERATOR },
      ownerId,
      sigKP.privateKey,
    )
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )
    expect(result.admitted).toBe(false)
    expect(result.reason).toBe('WRONG_ROOM')
  })

  it('fails with UNKNOWN_ISSUER when issuer is not in trustedSigningKeys', async () => {
    const { roomId, sigKP, roomKey } = await makeOwnerSetup()
    const unknownIssuerId = crypto.randomUUID()
    const shared = makeShared() // empty — no trusted keys
    localStorage.setItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`, await exportRoomKey(roomKey))

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT(
      { room: roomId, role: ROLES.MODERATOR },
      unknownIssuerId,
      sigKP.privateKey,
    )
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )
    expect(result.admitted).toBe(false)
    expect(result.reason).toBe('UNKNOWN_ISSUER')
  })

  it('fails with INVALID_SIGNATURE for a tampered JWT', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)

    // Tamper the signature (keeping header and payload valid base64 so decodeJWT succeeds)
    const parts = token.raw.split('.')
    const tamperedRaw = `${parts[0]}.${parts[1]}.invalidsignatureXXXX`

    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: tamperedRaw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )
    expect(result.admitted).toBe(false)
    expect(result.reason).toBe('INVALID_SIGNATURE')
  })

  it('fails with TOKEN_EXPIRED for an expired token', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT(
      { room: roomId, role: ROLES.MODERATOR },
      ownerId,
      sigKP.privateKey,
      1, // 1 second expiry
    )

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 2000)

    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )

    vi.useRealTimers()
    expect(result.admitted).toBe(false)
    expect(result.reason).toBe('TOKEN_EXPIRED')
  })

  it('fails with INVALID_NONCE_SIG when nonce signature is wrong', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)

    const nonce = issueNonce()
    // Sign a different nonce (wrong nonce)
    const wrongSig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, 'wrong-nonce'))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: wrongSig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )
    expect(result.admitted).toBe(false)
    expect(result.reason).toBe('INVALID_NONCE_SIG')
  })

  it('admits a moderator on first admission and returns encryptedRoomKey', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )
    expect(result.admitted).toBe(true)
    expect(result.role).toBe(ROLES.MODERATOR)
    expect(result.encryptedRoomKey).not.toBeNull()
    expect(result.reason).toBeNull()
  })

  it('admits a moderator and adds them to trustedSigningKeys', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )

    expect(shared.trustedSigningKeys.get(modSetup.modId)).toBe(modSetup.sigPubB64)
    expect(shared.admittedPeers.get(modSetup.modId)?.role).toBe(ROLES.MODERATOR)
  })

  it('admits a guest and never returns encryptedRoomKey', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const guestSetup = await makeGuestSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.GUEST }, ownerId, sigKP.privateKey)
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(guestSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: guestSetup.sigPubB64,
        oaepPubKeyB64: null, // guests have no OAEP key
        nonce,
        signatureB64: sig,
        peerId: guestSetup.guestId,
        roomId,
      },
      shared,
    )
    expect(result.admitted).toBe(true)
    expect(result.role).toBe(ROLES.GUEST)
    expect(result.encryptedRoomKey).toBeNull()
    expect(result.reason).toBeNull()
  })

  it('does not add guest to trustedSigningKeys', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const guestSetup = await makeGuestSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.GUEST }, ownerId, sigKP.privateKey)
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(guestSetup.sigKP.privateKey, nonce))

    await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: guestSetup.sigPubB64,
        oaepPubKeyB64: null,
        nonce,
        signatureB64: sig,
        peerId: guestSetup.guestId,
        roomId,
      },
      shared,
    )

    // Only the owner should be in trustedSigningKeys
    expect(shared.trustedSigningKeys.has(guestSetup.guestId)).toBe(false)
  })

  it('admits a reconnecting peer (jti already burned) using stored pubkey', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)

    // First admission
    const nonce1 = issueNonce()
    const sig1 = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce1))
    await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce: nonce1,
        signatureB64: sig1,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )

    // Reconnection with same token
    const nonce2 = issueNonce()
    const sig2 = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce2))
    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce: nonce2,
        signatureB64: sig2,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )

    expect(result.admitted).toBe(true)
    expect(result.role).toBe(ROLES.MODERATOR)
    expect(result.encryptedRoomKey).toBeNull() // no key on reconnect
    expect(result.reason).toBeNull()
  })

  it('fails with PUBKEY_MISMATCH on reconnect if signing key changed', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)

    // First admission
    const nonce1 = issueNonce()
    const sig1 = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce1))
    await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce: nonce1,
        signatureB64: sig1,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )

    // Reconnect with a different signing key (attacker trying to swap key)
    const impostor = await makeModeratorSetup()
    const nonce2 = issueNonce()
    const sig2 = bufferToBase64url(await signBytes(impostor.sigKP.privateKey, nonce2))
    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: impostor.sigPubB64, // different key
        oaepPubKeyB64: impostor.oaepPubB64,
        nonce: nonce2,
        signatureB64: sig2,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )

    expect(result.admitted).toBe(false)
    expect(result.reason).toBe('PUBKEY_MISMATCH')
  })

  it('encryptedRoomKey is null for guest in TypeScript return type', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const guestSetup = await makeGuestSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.GUEST }, ownerId, sigKP.privateKey)
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(guestSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: guestSetup.sigPubB64,
        oaepPubKeyB64: null,
        nonce,
        signatureB64: sig,
        peerId: guestSetup.guestId,
        roomId,
      },
      shared,
    )

    // TypeScript narrowing — encryptedRoomKey is string | null
    const key: string | null = result.encryptedRoomKey
    expect(key).toBeNull()
  })

  it('wraps room key with the moderator OAEP key and can be unwrapped', async () => {
    const { ownerId, roomId, sigKP, sigPubB64, roomKey } = await makeOwnerSetup()
    const { shared } = await setupOwnerShared(ownerId, sigPubB64, roomId, roomKey)

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )

    expect(result.encryptedRoomKey).not.toBeNull()

    // Verify the wrapped key can be unwrapped with the moderator's private key
    const { unwrapRoomKey } = await import('../crypto/oaep')
    const unwrapped = await unwrapRoomKey(result.encryptedRoomKey!, modSetup.oaepKP.privateKey)
    expect(unwrapped).toBeInstanceOf(CryptoKey)

    // Verify unwrapped key matches original by exporting both
    const originalExported = await exportRoomKey(roomKey)
    const unwrappedExported = await exportRoomKey(unwrapped)
    expect(unwrappedExported).toBe(originalExported)
  })

  it('fails with ROOM_KEY_NOT_FOUND when room key is missing from storage', async () => {
    const { ownerId, roomId, sigKP, sigPubB64 } = await makeOwnerSetup()
    const shared = makeShared()
    shared.trustedSigningKeys.set(ownerId, sigPubB64)
    // Do NOT save room key

    const modSetup = await makeModeratorSetup()
    const token = await mintJWT({ room: roomId, role: ROLES.MODERATOR }, ownerId, sigKP.privateKey)
    const nonce = issueNonce()
    const sig = bufferToBase64url(await signBytes(modSetup.sigKP.privateKey, nonce))

    const result = await evaluateAdmission(
      {
        token: token.raw,
        signingPubKeyB64: modSetup.sigPubB64,
        oaepPubKeyB64: modSetup.oaepPubB64,
        nonce,
        signatureB64: sig,
        peerId: modSetup.modId,
        roomId,
      },
      shared,
    )
    expect(result.admitted).toBe(false)
    expect(result.reason).toBe('ROOM_KEY_NOT_FOUND')
  })
})
