const SIGN_ALGO: RsaHashedKeyGenParams = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
}

/** Generates the RSA signing keypair. Used for JWT signing AND nonce identity proof. */
export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(SIGN_ALGO, true, ['sign', 'verify'])
}

export async function exportSigningPublicKey(key: CryptoKey): Promise<string> {
  return bufferToBase64url(await crypto.subtle.exportKey('spki', key))
}

export async function exportSigningPrivateKey(key: CryptoKey): Promise<string> {
  return bufferToBase64url(await crypto.subtle.exportKey('pkcs8', key))
}

export async function importSigningPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', base64urlToBuffer(b64), SIGN_ALGO, true, ['verify'])
}

export async function importSigningPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', base64urlToBuffer(b64), SIGN_ALGO, true, ['sign'])
}

/** Signs arbitrary bytes with the private key. Used for nonce signing during admission. */
export async function signBytes(
  privateKey: CryptoKey,
  data: string | ArrayBuffer,
): Promise<ArrayBuffer> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, bytes)
}

/** Verifies a signature against a public key. Used to validate nonce response. */
export async function verifySignature(
  publicKey: CryptoKey,
  signature: ArrayBuffer,
  data: string | ArrayBuffer,
): Promise<boolean> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, publicKey, signature, bytes)
}

/** Generates a 32-byte hex nonce. Called by the owner to challenge a peer. */
export function generateNonce(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}

// --- Encoding helpers (shared across all crypto modules) ---

export function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function base64urlToBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
  const str = atob(padded)
  const buf = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i)
  return buf.buffer
}
