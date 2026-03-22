import { exportSigningKey, importSigningPrivateKey, importSigningPublicKey } from './signing'
import { exportOaepKey, importOaepPrivateKey } from './oaep'
import { exportRoomKey, importRoomKey } from './roomKey'
import { STORAGE_KEYS, SESSION_KEYS } from '../../constants'

// --- Signing keypair ---

export async function saveSigningKeyPair(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  peerId: string,
): Promise<void> {
  localStorage.setItem(`${STORAGE_KEYS.SIGN_PRIV}:${peerId}`, await exportSigningKey(privateKey, 'private'))
  localStorage.setItem(`${STORAGE_KEYS.SIGN_PUB}:${peerId}`,  await exportSigningKey(publicKey, 'public'))
}

export async function loadSigningPrivateKey(peerId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(`${STORAGE_KEYS.SIGN_PRIV}:${peerId}`)
  return b64 ? importSigningPrivateKey(b64) : null
}

export async function loadSigningPublicKey(peerId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(`${STORAGE_KEYS.SIGN_PUB}:${peerId}`)
  return b64 ? importSigningPublicKey(b64) : null
}

export function loadSigningPublicKeyB64(peerId: string): string | null {
  return localStorage.getItem(`${STORAGE_KEYS.SIGN_PUB}:${peerId}`)
}

// --- OAEP keypair (owner + moderators only) ---

export async function saveOaepKeyPair(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  peerId: string,
): Promise<void> {
  localStorage.setItem(`${STORAGE_KEYS.OAEP_PRIV}:${peerId}`, await exportOaepKey(privateKey, 'private'))
  localStorage.setItem(`${STORAGE_KEYS.OAEP_PUB}:${peerId}`,  await exportOaepKey(publicKey, 'public'))
}

export async function loadOaepPrivateKey(peerId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(`${STORAGE_KEYS.OAEP_PRIV}:${peerId}`)
  return b64 ? importOaepPrivateKey(b64) : null
}

export function loadOaepPublicKeyB64(peerId: string): string | null {
  return localStorage.getItem(`${STORAGE_KEYS.OAEP_PUB}:${peerId}`)
}

// --- AES-GCM room key (owner + moderators only) ---

export async function saveRoomKey(roomKey: CryptoKey, roomId: string): Promise<void> {
  localStorage.setItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`, await exportRoomKey(roomKey))
}

export async function loadRoomKey(roomId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(`${STORAGE_KEYS.ROOM_KEY}:${roomId}`)
  return b64 ? importRoomKey(b64) : null
}

// --- Peer identity ---

export function savePeerId(peerId: string): void {
  localStorage.setItem(STORAGE_KEYS.PEER_ID, peerId)
}

export function loadPeerId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.PEER_ID)
}

/** Guest peer ID lives in sessionStorage — survives reload, dies on tab close. */
export function saveGuestPeerId(peerId: string): void {
  sessionStorage.setItem(SESSION_KEYS.GUEST_PEER_ID, peerId)
}

export function loadGuestPeerId(): string | null {
  return sessionStorage.getItem(SESSION_KEYS.GUEST_PEER_ID)
}
