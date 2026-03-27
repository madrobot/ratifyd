import { STORAGE_KEYS } from '../constants'
import { bufferToBase64url, base64urlToBuffer } from './helper'
import { RoomError } from './error/RoomError'

export interface EncryptedBlob {
  iv: string
  ciphertext: string
}

export class SessionKey {
  #key: CryptoKey

  private constructor(key: CryptoKey) {
    this.#key = key
  }

  static async generate(): Promise<SessionKey> {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ])
    return new SessionKey(key)
  }

  static async load(roomId: string): Promise<SessionKey | null> {
    const b64 = localStorage.getItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`)
    if (!b64) return null
    const key = await crypto.subtle.importKey(
      'raw',
      base64urlToBuffer(b64),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    )
    return new SessionKey(key)
  }

  static async fromWrapped(wrappedB64: string, oaepPrivKey: CryptoKey): Promise<SessionKey> {
    const rawKey = await crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      oaepPrivKey,
      base64urlToBuffer(wrappedB64),
    )
    const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, [
      'encrypt',
      'decrypt',
    ])
    return new SessionKey(key)
  }

  async save(roomId: string): Promise<void> {
    // SECURITY: raw AES-GCM key persisted to localStorage (survives tab close and browser restart).
    // Acceptable under the assumption that XSS on this origin is the primary threat and no additional
    // key-wrapping mechanism is available in this OSS version.
    const raw = await crypto.subtle.exportKey('raw', this.#key)
    localStorage.setItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`, bufferToBase64url(raw))
  }

  async encrypt(text: string): Promise<EncryptedBlob> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.#key,
      new TextEncoder().encode(text),
    )
    return { iv: bufferToBase64url(iv.buffer as ArrayBuffer), ciphertext: bufferToBase64url(enc) }
  }

  async decrypt(blob: EncryptedBlob): Promise<string> {
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64urlToBuffer(blob.iv) },
      this.#key,
      base64urlToBuffer(blob.ciphertext),
    )
    return new TextDecoder().decode(dec)
  }

  async wrapFor(recipientOaepPublicKey: CryptoKey): Promise<string> {
    if (recipientOaepPublicKey.algorithm.name !== 'RSA-OAEP') {
      throw new RoomError('recipientOaepPublicKey must be an RSA-OAEP key')
    }
    const raw = await crypto.subtle.exportKey('raw', this.#key)
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientOaepPublicKey, raw)
    return bufferToBase64url(wrapped)
  }
}
