import type { Role } from '../constants'
import { TokenError } from './error/TokenError'
import { base64urlToBuffer, bufferToBase64url } from '../utils/helper'

export interface Header {
  alg: string
  typ: string
}

export interface Payload {
  sub: string
  room: string
  role: Role
  iss: string
  jti: string
  iat: number
  exp: number
}

export class Claim {
  #raw: string | undefined
  #header: Header | undefined
  #signature: string | undefined
  #signingPublicKey: CryptoKey

  #sub: string | undefined
  #room: string | undefined
  #role: Role | undefined
  #iss: string | undefined
  #jti: string | undefined
  #iat: number | undefined
  #exp: number | undefined

  static async mint(
    sub: string,
    room: string,
    role: Role,
    iss: string,
    signingPublicKey: CryptoKey,
    signer: (data: BufferSource) => Promise<ArrayBuffer>,
    expirySeconds = 86400,
  ): Promise<Claim> {
    const claim = new Claim(signingPublicKey)
    const now = Math.floor(Date.now() / 1000)
    const header: Header = { alg: 'RS256', typ: 'JWT' }

    const fullPayload: Payload = {
      sub,
      room,
      role,
      iss,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + expirySeconds,
    }
    const headerB64 = Claim.#encodeB64url(header)
    const payloadB64 = Claim.#encodeB64url(fullPayload)
    const input = `${headerB64}.${payloadB64}`
    const sig = await signer(new TextEncoder().encode(input))
    const signature = bufferToBase64url(sig)

    claim.#raw = `${input}.${signature}`
    claim.#header = header
    claim.#signature = signature
    claim.#sub = fullPayload.sub
    claim.#room = fullPayload.room
    claim.#role = fullPayload.role
    claim.#iss = fullPayload.iss
    claim.#jti = fullPayload.jti
    claim.#iat = fullPayload.iat
    claim.#exp = fullPayload.exp

    return claim
  }

  static async verify(token: string, signingPublicKey: CryptoKey): Promise<Claim> {
    const claim = new Claim(signingPublicKey)
    const { header, payload, signature } = await claim.#decodeJWT(token)
    claim.#raw = token
    claim.#header = header
    claim.#signature = signature
    claim.#sub = payload.sub
    claim.#room = payload.room
    claim.#role = payload.role
    claim.#iss = payload.iss
    claim.#jti = payload.jti
    claim.#iat = payload.iat
    claim.#exp = payload.exp
    return claim
  }

  static async peek<T extends keyof Payload>(token: string, prop: T): Promise<Payload[T]> {
    const parts = token.split('.')
    if (parts.length !== 3) throw new TokenError('Malformed token')
    return Claim.#decodeB64url<Payload>(parts[1])[prop]
  }

  private constructor(signingPublicKey: CryptoKey) {
    this.#signingPublicKey = signingPublicKey
  }

  get raw(): string {
    return this.#raw!
  }

  get header(): Header {
    return this.#header!
  }

  get sub(): string {
    this.#checkExpiry()
    return this.#sub!
  }

  get room(): string {
    this.#checkExpiry()
    return this.#room!
  }

  get role(): Role {
    this.#checkExpiry()
    return this.#role!
  }

  get issuer(): string {
    this.#checkExpiry()
    return this.#iss!
  }

  get jti(): string {
    this.#checkExpiry()
    return this.#jti!
  }

  get issuedAt(): number {
    this.#checkExpiry()
    return this.#iat!
  }

  get expiry(): number {
    return this.#exp!
  }

  get signature(): string {
    return this.#signature!
  }

  async #decodeJWT(
    token: string,
  ): Promise<{ header: Header; payload: Payload; signature: string }> {
    const parts = token.split('.')
    if (parts.length !== 3) throw new TokenError('Malformed token')

    const [h, p, s] = parts
    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      this.#signingPublicKey,
      base64urlToBuffer(s),
      new TextEncoder().encode(`${h}.${p}`),
    )
    if (!valid) throw new TokenError('Invalid token signature')

    const payload = Claim.#decodeB64url<Payload>(p)
    if (
      !('sub' in payload) ||
      !('room' in payload) ||
      !('role' in payload) ||
      !('iss' in payload) ||
      !('jti' in payload) ||
      !('iat' in payload) ||
      !('exp' in payload)
    )
      throw new TokenError('Malformed token payload')

    return {
      header: Claim.#decodeB64url<Header>(h),
      payload,
      signature: s,
    }
  }

  static #encodeB64url(obj: unknown): string {
    return bufferToBase64url(new TextEncoder().encode(JSON.stringify(obj)).buffer)
  }

  static #decodeB64url<T>(str: string): T {
    return JSON.parse(new TextDecoder().decode(base64urlToBuffer(str))) as T
  }

  #checkExpiry() {
    if (!this.#exp) throw new TokenError('Token expiry not set')
    if (this.#exp < Math.floor(Date.now() / 1000)) throw new TokenError('Token expired')
  }
}
