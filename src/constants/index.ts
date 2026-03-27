export const ROLES = {
  OWNER: 'owner',
  MODERATOR: 'moderator',
  GUEST: 'guest',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

export const JWT_EXPIRY_SECONDS = 60 * 60 * 24 // 24 hours

export const YJS_ROOM_PREFIX = 'ratifyd-room-'

export const SIGNALING_SERVERS: string[] = [
  'wss://signaling.yjs.dev',
  'wss://y-webrtc-signaling-eu.herokuapp.com',
  'wss://y-webrtc-signaling-us.herokuapp.com',
]

export const STORAGE_KEYS = {
  IDENTITY: 'ratifyd:identity', // Stable identity (all roles)
  ROOM_KEY: 'ratifyd:roomkey', // AES-GCM room key     (owner + moderators)
} as const
