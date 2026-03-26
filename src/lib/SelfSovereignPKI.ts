import { Claim } from './Claim'
import { Identity } from './Identity'
import { AuthError } from './error/AuthError'
import { base64urlToBuffer } from './helper'
import { TTLMap } from './TTLMap'

export class SelfSovereignPKI {
  #admissionRequests = new TTLMap<string, { nonce: string }>()

  constructor() {}

  async requestAdmission(
    token: string,
    issuerSigningPublicKey: string | null,
  ): Promise<{ nonce: string }> {
    if (!issuerSigningPublicKey) throw new AuthError('Unknown token issuer')
    const claim = await Claim.verify(
      token,
      await Identity.importSigningPublicKey(issuerSigningPublicKey),
    )
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

    const pending = this.#admissionRequests.get(claim.jti)
    this.#admissionRequests.delete(claim.jti) // burn nonce BEFORE verification to prevent replay
    return this.#verifyNonceSignature(
      await Identity.importSigningPublicKey(knownPeerSigningPublicKey ?? peerSigningPublicKey),
      base64urlToBuffer(nonceSignature),
      pending?.nonce || null,
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
