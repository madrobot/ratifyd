import {
  exportSigningPrivateKey,
  exportSigningPublicKey,
  importSigningPrivateKey,
  importSigningPublicKey,
} from './signing'
import { exportOaepPrivateKey, exportOaepPublicKey, importOaepPrivateKey } from './oaep'
import { exportRoomKey, importRoomKey } from './roomKey'
import { STORAGE_KEYS } from '../../constants'

// --- Signing keypair ---

export async function saveSigningKeyPair(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  peerId: string,
): Promise<void> {
  localStorage.setItem(
    `${STORAGE_KEYS.SIGN_PRIV}:${peerId}`,
    await exportSigningPrivateKey(privateKey),
  )
  localStorage.setItem(
    `${STORAGE_KEYS.SIGN_PUB}:${peerId}`,
    await exportSigningPublicKey(publicKey),
  )
}

export async function loadSigningPrivateKey(peerId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(`${STORAGE_KEYS.SIGN_PRIV}:${peerId}`)
  return b64 ? importSigningPrivateKey(b64) : null
}

export async function loadSigningPublicKey(peerId: string): Promise<CryptoKey | null> {
  const b64 = localStorage.getItem(`${STORAGE_KEYS.SIGN_PUB}:${peerId}`)
  return b64 ? importSigningPublicKey(b64) : null
}

// --- OAEP keypair (owner + moderators only) ---

export async function saveOaepKeyPair(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  peerId: string,
): Promise<void> {
  localStorage.setItem(
    `${STORAGE_KEYS.OAEP_PRIV}:${peerId}`,
    await exportOaepPrivateKey(privateKey),
  )
  localStorage.setItem(`${STORAGE_KEYS.OAEP_PUB}:${peerId}`, await exportOaepPublicKey(publicKey))
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
