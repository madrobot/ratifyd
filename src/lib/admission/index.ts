import { decodeJWT, verifyJWT } from '../jwt'
import {
  importSigningPublicKey,
  verifySignature,
  generateNonce,
  base64urlToBuffer,
} from '../crypto/signing'
import { importOaepPublicKey, wrapRoomKey } from '../crypto/oaep'
import { loadRoomKey } from '../crypto/storage'
import { ROLES } from '../../constants'
import type { JWTPayload } from '../../constants'
import type { SharedTypes } from '../yjs/doc'

export interface AdmissionParams {
  token: string
  signingPubKeyB64: string
  oaepPubKeyB64: string | null // null for guests
  nonce: string
  signatureB64: string
  peerId: string
  roomId: string
}

export interface AdmissionResult {
  admitted: boolean
  role: string | null
  encryptedRoomKey: string | null // only for moderators on first admission
  reason: string | null
}

/**
 * Returns true if the current peer is the owner who may self-admit.
 *
 * ALL conditions required:
 * 1. jwt.role === 'owner'
 * 2. localPeerId !== null (key in localStorage)
 * 3. jwt.iss === localPeerId  ← self-issued; only room creator qualifies
 * 4. No other peers connected
 *
 * Moderators fail condition 3 (iss is someone else's ID).
 * Guests fail condition 1.
 */
export function isOwnerSelfAdmit(
  jwtPayload: JWTPayload,
  localPeerId: string | null,
  hasOtherPeers: boolean,
): boolean {
  return (
    jwtPayload.role === ROLES.OWNER &&
    localPeerId !== null &&
    jwtPayload.iss === localPeerId &&
    !hasOtherPeers
  )
}

/** Self-admission for the owner. Idempotent — safe on repeated solo reloads. */
export function ownerSelfAdmit(
  jwtPayload: JWTPayload,
  signingPubKeyB64: string,
  ownerId: string,
  shared: SharedTypes,
): void {
  if (!shared.burnedJTIs.has(jwtPayload.jti)) {
    shared.burnedJTIs.set(jwtPayload.jti, signingPubKeyB64)
  }
  if (!shared.trustedSigningKeys.has(ownerId)) {
    shared.trustedSigningKeys.set(ownerId, signingPubKeyB64)
  }
  if (!shared.admittedPeers.has(ownerId)) {
    shared.admittedPeers.set(ownerId, { role: ROLES.OWNER, admittedAt: Date.now() })
  }
}

/**
 * Generates a fresh nonce to challenge an incoming peer (Round 2).
 * The owner ALWAYS issues the nonce — never the connecting peer.
 * Verifier-issued nonce prevents replay attacks.
 */
export { generateNonce as issueNonce }

/**
 * Evaluates a peer admission request (Round 4). Called only by the owner.
 *
 * On moderator success: wraps the room key with the moderator's OAEP public key.
 * On guest success: no room key returned. Ever.
 */
export async function evaluateAdmission(
  params: AdmissionParams,
  shared: SharedTypes,
): Promise<AdmissionResult> {
  const { token, signingPubKeyB64, oaepPubKeyB64, nonce, signatureB64, peerId, roomId } = params
  const claimToken = decodeJWT(token)
  const { payload } = claimToken
  const fail = (reason: string): AdmissionResult => ({
    admitted: false,
    role: null,
    encryptedRoomKey: null,
    reason,
  })

  if (payload.room !== roomId) return fail('WRONG_ROOM')

  const isReconnect = shared.burnedJTIs.has(payload.jti)

  // Both paths verify JWT signature and expiry first
  const issuerPubKeyB64 = shared.trustedSigningKeys.get(payload.iss)
  if (!issuerPubKeyB64) return fail('UNKNOWN_ISSUER')

  const issuerPubKey = await importSigningPublicKey(issuerPubKeyB64)
  const jwtResult = await verifyJWT(claimToken, issuerPubKey)
  if (!jwtResult.valid) return fail(jwtResult.reason)

  if (!isReconnect) {
    // --- FIRST ADMISSION ---
    const incomingPubKey = await importSigningPublicKey(signingPubKeyB64)
    const sigOk = await verifySignature(incomingPubKey, base64urlToBuffer(signatureB64), nonce)
    if (!sigOk) return fail('INVALID_NONCE_SIG')

    shared.burnedJTIs.set(payload.jti, signingPubKeyB64)
    shared.admittedPeers.set(peerId, { role: payload.role, admittedAt: Date.now() })

    if (payload.role === ROLES.MODERATOR) {
      shared.trustedSigningKeys.set(peerId, signingPubKeyB64)
    }

    // Wrap room key for moderators. NEVER for guests.
    let encryptedRoomKey: string | null = null
    if (payload.role === ROLES.MODERATOR && oaepPubKeyB64) {
      const currentRoomKey = await loadRoomKey(payload.room)
      if (!currentRoomKey) return fail('ROOM_KEY_NOT_FOUND')
      const oaepPubKey = await importOaepPublicKey(oaepPubKeyB64)
      encryptedRoomKey = await wrapRoomKey(currentRoomKey, oaepPubKey)
    }

    return { admitted: true, role: payload.role, encryptedRoomKey, reason: null }
  }

  // --- RECONNECTION ---
  const storedPubKeyB64 = shared.burnedJTIs.get(payload.jti)
  if (signingPubKeyB64 !== storedPubKeyB64) return fail('PUBKEY_MISMATCH')

  const storedPubKey = await importSigningPublicKey(storedPubKeyB64)
  const sigOk = await verifySignature(storedPubKey, base64urlToBuffer(signatureB64), nonce)
  if (!sigOk) return fail('INVALID_NONCE_SIG')

  const peerRecord = shared.admittedPeers.get(peerId)
  return {
    admitted: true,
    role: peerRecord?.role ?? payload.role,
    encryptedRoomKey: null,
    reason: null,
  }
}
