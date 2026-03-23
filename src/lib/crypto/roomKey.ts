import { bufferToBase64url, base64urlToBuffer } from './signing'

export interface EncryptedBlob {
  iv: string
  ciphertext: string
}

/**
 * Generates the AES-GCM room key.
 * Called once by the owner at room creation.
 * Never transmitted to guests. Distributed to moderators via RSA-OAEP wrapping.
 */
export async function generateRoomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

export async function exportRoomKey(key: CryptoKey): Promise<string> {
  return bufferToBase64url(await crypto.subtle.exportKey('raw', key))
}

export async function importRoomKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', base64urlToBuffer(b64), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypts plaintext with the AES-GCM room key.
 * Generates a fresh random 96-bit IV for every call.
 */
export async function encryptWithRoomKey(
  plaintext: string,
  roomKey: CryptoKey,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, roomKey, encoded)
  return {
    iv: bufferToBase64url(iv.buffer),
    ciphertext: bufferToBase64url(encrypted),
  }
}

/** Decrypts an EncryptedBlob with the AES-GCM room key. */
export async function decryptWithRoomKey(blob: EncryptedBlob, roomKey: CryptoKey): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64urlToBuffer(blob.iv) },
    roomKey,
    base64urlToBuffer(blob.ciphertext),
  )
  return new TextDecoder().decode(decrypted)
}
