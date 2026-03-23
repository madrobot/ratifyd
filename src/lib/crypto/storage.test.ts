import { describe, it, expect, beforeEach } from 'vitest'
import {
  saveSigningKeyPair,
  loadSigningPrivateKey,
  loadSigningPublicKey,
  saveOaepKeyPair,
  loadOaepPrivateKey,
  loadOaepPublicKeyB64,
  saveRoomKey,
  loadRoomKey,
  savePeerId,
  loadPeerId,
} from './storage'
import { generateSigningKeyPair, exportSigningPrivateKey, exportSigningPublicKey } from './signing'
import { generateOaepKeyPair, exportOaepPublicKey, exportOaepPrivateKey } from './oaep'
import { generateRoomKey, exportRoomKey } from './roomKey'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('signing keypair storage', () => {
  it('saves and loads a signing private key', async () => {
    const pair = await generateSigningKeyPair()
    await saveSigningKeyPair(pair.privateKey, pair.publicKey, 'peer-1')
    const loaded = await loadSigningPrivateKey('peer-1')
    expect(loaded).not.toBeNull()
    const original = await exportSigningPrivateKey(pair.privateKey)
    const reExported = await exportSigningPrivateKey(loaded!)
    expect(reExported).toBe(original)
  })

  it('saves and loads a signing public key', async () => {
    const pair = await generateSigningKeyPair()
    await saveSigningKeyPair(pair.privateKey, pair.publicKey, 'peer-1')
    const loaded = await loadSigningPublicKey('peer-1')
    expect(loaded).not.toBeNull()
    const original = await exportSigningPublicKey(pair.publicKey)
    const reExported = await exportSigningPublicKey(loaded!)
    expect(reExported).toBe(original)
  })

  it('returns null for non-existent peerId', async () => {
    const priv = await loadSigningPrivateKey('nonexistent')
    const pub = await loadSigningPublicKey('nonexistent')
    expect(priv).toBeNull()
    expect(pub).toBeNull()
  })

  it('isolates keys by peerId', async () => {
    const pair1 = await generateSigningKeyPair()
    const pair2 = await generateSigningKeyPair()
    await saveSigningKeyPair(pair1.privateKey, pair1.publicKey, 'peer-1')
    await saveSigningKeyPair(pair2.privateKey, pair2.publicKey, 'peer-2')
    const pub1 = await loadSigningPublicKey('peer-1')
    const pub2 = await loadSigningPublicKey('peer-2')
    const pub1B64 = await exportSigningPublicKey(pub1!)
    const pub2B64 = await exportSigningPublicKey(pub2!)
    expect(pub1B64).not.toBe(pub2B64)
  })
})

describe('OAEP keypair storage', () => {
  it('saves and loads an OAEP private key', async () => {
    const pair = await generateOaepKeyPair()
    await saveOaepKeyPair(pair.privateKey, pair.publicKey, 'peer-1')
    const loaded = await loadOaepPrivateKey('peer-1')
    expect(loaded).not.toBeNull()
    const original = await exportOaepPrivateKey(pair.privateKey)
    const reExported = await exportOaepPrivateKey(loaded!)
    expect(reExported).toBe(original)
  })

  it('loads OAEP public key as base64url string', async () => {
    const pair = await generateOaepKeyPair()
    await saveOaepKeyPair(pair.privateKey, pair.publicKey, 'peer-1')
    const b64 = loadOaepPublicKeyB64('peer-1')
    expect(b64).not.toBeNull()
    const expected = await exportOaepPublicKey(pair.publicKey)
    expect(b64).toBe(expected)
  })

  it('returns null for non-existent peerId', async () => {
    const priv = await loadOaepPrivateKey('nonexistent')
    const b64 = loadOaepPublicKeyB64('nonexistent')
    expect(priv).toBeNull()
    expect(b64).toBeNull()
  })
})

describe('room key storage', () => {
  it('saves and loads a room key', async () => {
    const key = await generateRoomKey()
    await saveRoomKey(key, 'room-abc')
    const loaded = await loadRoomKey('room-abc')
    expect(loaded).not.toBeNull()
    expect(await exportRoomKey(loaded!)).toBe(await exportRoomKey(key))
  })

  it('returns null for non-existent roomId', async () => {
    const loaded = await loadRoomKey('nonexistent')
    expect(loaded).toBeNull()
  })

  it('isolates keys by roomId', async () => {
    const key1 = await generateRoomKey()
    const key2 = await generateRoomKey()
    await saveRoomKey(key1, 'room-1')
    await saveRoomKey(key2, 'room-2')
    const loaded1 = await loadRoomKey('room-1')
    const loaded2 = await loadRoomKey('room-2')
    expect(await exportRoomKey(loaded1!)).toBe(await exportRoomKey(key1))
    expect(await exportRoomKey(loaded2!)).toBe(await exportRoomKey(key2))
  })
})

describe('peer identity storage', () => {
  it('saves and loads a peerId', () => {
    savePeerId('my-peer-id')
    expect(loadPeerId()).toBe('my-peer-id')
  })

  it('returns null when no peerId is saved', () => {
    expect(loadPeerId()).toBeNull()
  })

  it('overwrites previous peerId', () => {
    savePeerId('first')
    savePeerId('second')
    expect(loadPeerId()).toBe('second')
  })
})
