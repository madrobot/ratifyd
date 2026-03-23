import { bufferToBase64url, base64urlToBuffer } from '../crypto/signing'
import type { ClaimToken, JWTHeader, JWTPayload } from '../../constants'

export type VerifyResult =
  | { valid: true; payload: JWTPayload; reason: null }
  | { valid: false; payload: null; reason: string }

function encodeB64url(obj: unknown): string {
  return bufferToBase64url(new TextEncoder().encode(JSON.stringify(obj)).buffer)
}

function decodeB64url<T>(str: string): T {
  return JSON.parse(new TextDecoder().decode(base64urlToBuffer(str))) as T
}

/**
 * Mints a signed JWT using the RSA signing private key.
 * Returns a ClaimToken with decoded header, payload, signature, and the raw string.
 * The jti is generated automatically.
 */
export async function mintJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti' | 'iss'>,
  issuerId: string,
  signingPrivateKey: CryptoKey,
  expirySeconds = 86400,
): Promise<ClaimToken> {
  const now = Math.floor(Date.now() / 1000)
  const header: JWTHeader = { alg: 'RS256', typ: 'JWT' }
  const fullPayload: JWTPayload = {
    ...payload,
    iss: issuerId,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + expirySeconds,
  }
  const headerB64 = encodeB64url(header)
  const payloadB64 = encodeB64url(fullPayload)
  const input = `${headerB64}.${payloadB64}`
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    signingPrivateKey,
    new TextEncoder().encode(input),
  )
  const signature = bufferToBase64url(sig)
  const raw = `${input}.${signature}`
  return { header, payload: fullPayload, signature, raw }
}

/**
 * Decodes JWT without verification. Throws on malformed input.
 * Always follow up with verifyJWT before trusting any claims.
 */
export function decodeJWT(token: string): ClaimToken {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('MALFORMED_TOKEN')
  const [h, p, s] = parts
  return {
    header: decodeB64url<JWTHeader>(h),
    payload: decodeB64url<JWTPayload>(p),
    signature: s,
    raw: token,
  }
}

/** Verifies JWT signature (first) then expiry against a given public key. */
export async function verifyJWT(
  token: ClaimToken,
  signingPublicKey: CryptoKey,
): Promise<VerifyResult> {
  try {
    const [h, p, s] = token.raw.split('.')
    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      signingPublicKey,
      base64urlToBuffer(s),
      new TextEncoder().encode(`${h}.${p}`),
    )
    if (!valid) return { valid: false, payload: null, reason: 'INVALID_SIGNATURE' }
    if (token.payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, payload: null, reason: 'TOKEN_EXPIRED' }
    }
    return { valid: true, payload: token.payload, reason: null }
  } catch {
    return { valid: false, payload: null, reason: 'MALFORMED_TOKEN' }
  }
}
