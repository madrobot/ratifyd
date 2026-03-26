import type { WebrtcProvider } from 'y-webrtc'
import { ROLES } from '../constants'
import { Claim } from './Claim'
import { Identity } from './Identity'
import { AuthError } from './error/AuthError'
import { base64urlToBuffer } from './helper'
import { TTLMap } from './TTLMap'

export class SelfSovereignPKI {
  #webrtc: WebrtcProvider
  #admissionRequests = new TTLMap<string, { nonce: string }>()

  constructor(webrtc: WebrtcProvider) {
    this.#webrtc = webrtc
  }

  async requestAdmission(
    token: string,
    issuerSigningPublicKey: string | null,
  ): Promise<{ nonce: string } | true> {
    if (!issuerSigningPublicKey) throw new AuthError('Unknown token issuer')

    const claim = await Claim.verify(
      token,
      await Identity.importSigningPublicKey(issuerSigningPublicKey),
    )
    const identity = await Identity.load()

    // --- OWNER SELF-ADMIT ---
    // * ALL conditions required:
    // * 1. role === 'owner'
    // * 2. localId !== null (key in localStorage)
    // * 3. iss === localId  ← self-issued; only room creator qualifies
    // * 4. No other peers connected
    // * IF TRUE, then short-circuit the protocol
    if (
      !!identity?.id &&
      claim.role === ROLES.OWNER &&
      claim.issuer === identity.id &&
      this.#webrtc.awareness.getStates().size <= 0
    ) {
      return true
    }

    // --- NORMAL ADMISSION REQUEST ---
    // For moderators and guests, the client must request admission from an existing owner.
    // The server responds with a nonce, which the client must sign with their signing key and return
    // in a follow-up request to prove ownership of the signing key.
    // The server then verifies the signature and either admits or rejects the client.
    const nonce = this.#generateNonce()
    this.#admissionRequests.set(claim.jti, { nonce }, 5 * 60 * 1000)
    return { nonce }
  }

  async respondToChallenge(
    token: string,
    issuerSigningPublicKey: string | null,
    peerSigningPublicKey: string,
    nonceSignature: string,
    knownPeerSigningPublicKey: string | null,
  ): Promise<true> {
    if (!issuerSigningPublicKey) throw new AuthError('Unknown token issuer')
    if (!!knownPeerSigningPublicKey && knownPeerSigningPublicKey !== peerSigningPublicKey) {
      throw new AuthError('Invite token owner mismatch')
    }

    const claim = await Claim.verify(
      token,
      await Identity.importSigningPublicKey(issuerSigningPublicKey),
    )

    return this.#verifyNonceSignature(
      await Identity.importSigningPublicKey(knownPeerSigningPublicKey ?? peerSigningPublicKey),
      base64urlToBuffer(nonceSignature),
      this.#admissionRequests.get(claim.jti)?.nonce || null,
    )
  }

  #generateNonce(): string {
    const b = new Uint8Array(32)
    crypto.getRandomValues(b)
    return Array.from(b)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
  }

  async #verifyNonceSignature(
    publicKey: CryptoKey,
    signature: ArrayBuffer,
    nonce: string | ArrayBuffer | null,
  ): Promise<true> {
    if (!nonce) throw new AuthError('No nonce issued for this token')
    const bytes = typeof nonce === 'string' ? new TextEncoder().encode(nonce) : nonce
    const isOk = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      publicKey,
      signature,
      bytes,
    )
    if (!isOk) throw new AuthError('Invalid nonce signature')
    return true
  }

  destroy(): void {
    this.#admissionRequests.destroy()
  }
}
