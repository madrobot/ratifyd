export const ROLES = {
  OWNER: 'owner',
  MODERATOR: 'moderator',
  GUEST: 'guest',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

export interface JWTHeader {
  alg: string
  typ: string
}

export interface JWTPayload {
  room: string
  role: Role
  iss: string
  jti: string
  iat: number
  exp: number
}

export interface ClaimToken {
  header: JWTHeader
  payload: JWTPayload
  signature: string
  raw: string
}

export const JWT_EXPIRY_SECONDS = 60 * 60 * 24 // 24 hours

export const YJS_ROOM_PREFIX = 'ratifyd-room-'

export const SIGNALING_SERVERS: string[] = [
  'wss://signaling.yjs.dev',
  'wss://y-webrtc-signaling-eu.herokuapp.com',
  'wss://y-webrtc-signaling-us.herokuapp.com',
]

export const STORAGE_KEYS = {
  SIGN_PRIV: 'ratifyd:sign:priv', // RSA signing private key
  SIGN_PUB: 'ratifyd:sign:pub', // RSA signing public key
  OAEP_PRIV: 'ratifyd:oaep:priv', // RSA-OAEP private key (owner + moderators)
  OAEP_PUB: 'ratifyd:oaep:pub', // RSA-OAEP public key  (owner + moderators)
  ROOM_KEY: 'ratifyd:roomkey', // AES-GCM room key     (owner + moderators)
  PEER_ID: 'ratifyd:peerId', // Stable identity UUID (all roles)
} as const
