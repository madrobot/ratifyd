import { generateUsername } from 'unique-username-generator'
import { base64urlToBuffer, bufferToBase64url } from './helper'
import { STORAGE_KEYS } from '../constants'
import type { Role } from '../constants'
import { IdentityError } from './error/IdentityError'
import { Claim } from './Claim'

const SIGN_ALGO: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

const OAEP_ALGO: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

interface KeyPairExport {
  privateKey: string
  publicKey: string
}

interface IdentityExport {
  id: string
  label: string
  signingKeyPair: KeyPairExport
  oaepKeyPair: KeyPairExport | null
}

export class Identity {
  #id: string
  #label: string
  #signingKeyPair: CryptoKeyPair | undefined
  #oaepKeyPair: CryptoKeyPair | undefined

  private constructor(label?: string) {
    this.#id = crypto.randomUUID()
    this.#label = label ?? generateUsername(' ')
  }

  static async create(label?: string, withOaepKey?: boolean): Promise<Identity> {
    const identity = new Identity(label)

    identity.#signingKeyPair = await crypto.subtle.generateKey(SIGN_ALGO, true, ['sign', 'verify'])

    if (withOaepKey)
      identity.#oaepKeyPair = await crypto.subtle.generateKey(OAEP_ALGO, true, [
        'encrypt',
        'decrypt',
      ])

    return identity
  }

  get id(): string {
    return this.#id
  }

  get label(): string {
    return this.#label
  }

  get signingPublicKey(): CryptoKey {
    if (!this.#signingKeyPair) throw new IdentityError('Invalid identity, missing signing key')
    return this.#signingKeyPair.publicKey
  }

  get oaepPublicKey(): CryptoKey | null {
    return this.#oaepKeyPair?.publicKey ?? null
  }

  async getSigningPublicKeyB64(): Promise<string> {
    if (!this.#signingKeyPair) throw new Error('Signing key pair not generated')
    return bufferToBase64url(await crypto.subtle.exportKey('spki', this.#signingKeyPair!.publicKey))
  }

  async getOaepPublicKeyB64(): Promise<string | null> {
    if (!this.#oaepKeyPair) return null
    return bufferToBase64url(await crypto.subtle.exportKey('spki', this.#oaepKeyPair!.publicKey))
  }

  async sign(data: string | ArrayBuffer): Promise<ArrayBuffer> {
    if (!this.#signingKeyPair) throw new Error('Signing key pair not generated')
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    return crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      this.#signingKeyPair!.privateKey,
      bytes,
    )
  }

  async verify(signature: ArrayBuffer, data: string | ArrayBuffer): Promise<boolean> {
    if (!this.#signingKeyPair) throw new Error('Signing key pair not generated')
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    return crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      this.#signingKeyPair!.publicKey,
      signature,
      bytes,
    )
  }

  async save(): Promise<Identity> {
    if (!this.#signingKeyPair) throw new Error('Signing key pair not generated')

    const exp: IdentityExport = {
      id: this.#id,
      label: this.#label,
      signingKeyPair: {
        privateKey: bufferToBase64url(
          await crypto.subtle.exportKey('pkcs8', this.#signingKeyPair!.privateKey),
        ),
        publicKey: await this.getSigningPublicKeyB64(),
      },
      oaepKeyPair: null,
    }

    if (this.#oaepKeyPair) {
      exp.oaepKeyPair = {
        privateKey: bufferToBase64url(
          await crypto.subtle.exportKey('pkcs8', this.#oaepKeyPair!.privateKey),
        ),
        publicKey: (await this.getOaepPublicKeyB64())!,
      }
    }

    localStorage.setItem(
      STORAGE_KEYS.IDENTITY,
      bufferToBase64url(new TextEncoder().encode(JSON.stringify(exp)).buffer),
    )

    return this
  }

  static async load(): Promise<Identity | null> {
    const b64 = localStorage.getItem(STORAGE_KEYS.IDENTITY)
    if (!b64) return null

    const exp = JSON.parse(
      new TextDecoder().decode(new Uint8Array(base64urlToBuffer(b64))),
    ) as IdentityExport

    const identity = new Identity()
    identity.#id = exp.id
    identity.#label = exp.label
    identity.#signingKeyPair = {
      privateKey: await Identity.importSigningPrivateKey(exp.signingKeyPair.privateKey),
      publicKey: await Identity.importSigningPublicKey(exp.signingKeyPair.publicKey),
    }

    if (exp.oaepKeyPair) {
      identity.#oaepKeyPair = {
        privateKey: await Identity.importOaepPrivateKey(exp.oaepKeyPair.privateKey),
        publicKey: await Identity.importOaepPublicKey(exp.oaepKeyPair.publicKey),
      }
    }

    return identity
  }

  static async importSigningPublicKey(b64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey('spki', base64urlToBuffer(b64), SIGN_ALGO, true, ['verify'])
  }

  static async importSigningPrivateKey(b64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey('pkcs8', base64urlToBuffer(b64), SIGN_ALGO, true, ['sign'])
  }

  static async importOaepPublicKey(b64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey('spki', base64urlToBuffer(b64), OAEP_ALGO, true, ['encrypt'])
  }

  static async importOaepPrivateKey(b64: string): Promise<CryptoKey> {
    return crypto.subtle.importKey('pkcs8', base64urlToBuffer(b64), OAEP_ALGO, true, ['decrypt'])
  }

  async mintClaim(sub: string, room: string, role: Role, iss: string): Promise<Claim> {
    if (!this.#signingKeyPair)
      throw new IdentityError('Cannot mint claim: signing key pair not present')
    return Claim.mint(sub, room, role, iss, this.#signingKeyPair.publicKey, (data) =>
      this.sign(data),
    )
  }

  async wrapRoomKey(roomKey: CryptoKey, recipientOaepPublicKey: CryptoKey): Promise<string> {
    if (recipientOaepPublicKey.algorithm.name !== 'RSA-OAEP')
      throw new IdentityError('recipientOaepPublicKey must be an RSA-OAEP key')
    const rawKey = await crypto.subtle.exportKey('raw', roomKey)
    const wrapped = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      recipientOaepPublicKey,
      rawKey,
    )
    return bufferToBase64url(wrapped)
  }

  async unwrapRoomKey(wrappedKeyB64: string): Promise<CryptoKey> {
    if (!this.#oaepKeyPair)
      throw new IdentityError('Cannot unwrap room key: OAEP key pair not present')
    const wrapped = base64urlToBuffer(wrappedKeyB64)
    const rawKey = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      this.#oaepKeyPair.privateKey,
      wrapped,
    )
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
  }

  // CANONICAL: This replaces crypto/storage.ts::saveRoomKey/loadRoomKey
  async saveRoomKey(roomKey: CryptoKey, roomId: string): Promise<void> {
    // SECURITY: raw AES-GCM key persisted to localStorage (survives tab close and browser restart).
    // Acceptable under the assumption that XSS on this origin is the primary threat and no additional
    // key-wrapping mechanism is available in this OSS version.
    const raw = await crypto.subtle.exportKey('raw', roomKey)
    localStorage.setItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`, bufferToBase64url(raw))
  }

  static async loadRoomKey(roomId: string): Promise<CryptoKey | null> {
    const b64 = localStorage.getItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`)
    if (!b64) return null
    return crypto.subtle.importKey('raw', base64urlToBuffer(b64), { name: 'AES-GCM' }, true, [
      'encrypt',
      'decrypt',
    ])
  }
}
