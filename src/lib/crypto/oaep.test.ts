import { describe, it, expect } from 'vitest'
import {
  generateOaepKeyPair,
  exportOaepKey,
  importOaepPublicKey,
  importOaepPrivateKey,
  wrapRoomKey,
  unwrapRoomKey,
} from './oaep'
import { generateRoomKey, exportRoomKey } from './roomKey'

describe('generateOaepKeyPair', () => {
  it('generates a keypair with RSA-OAEP algorithm', async () => {
    const pair = await generateOaepKeyPair()
    expect(pair.publicKey.algorithm.name).toBe('RSA-OAEP')
    expect(pair.privateKey.algorithm.name).toBe('RSA-OAEP')
  })

  it('generates extractable keys', async () => {
    const pair = await generateOaepKeyPair()
    expect(pair.publicKey.extractable).toBe(true)
    expect(pair.privateKey.extractable).toBe(true)
  })

  it('generates keys with correct usages', async () => {
    const pair = await generateOaepKeyPair()
    expect(pair.publicKey.usages).toContain('encrypt')
    expect(pair.privateKey.usages).toContain('decrypt')
  })

  it('generates unique keypairs each time', async () => {
    const pair1 = await generateOaepKeyPair()
    const pair2 = await generateOaepKeyPair()
    const pub1 = await exportOaepKey(pair1.publicKey, 'public')
    const pub2 = await exportOaepKey(pair2.publicKey, 'public')
    expect(pub1).not.toBe(pub2)
  })
})

describe('exportOaepKey / importOaepPublicKey / importOaepPrivateKey', () => {
  it('round-trips a public key', async () => {
    const pair = await generateOaepKeyPair()
    const exported = await exportOaepKey(pair.publicKey, 'public')
    const imported = await importOaepPublicKey(exported)
    const reExported = await exportOaepKey(imported, 'public')
    expect(reExported).toBe(exported)
  })

  it('round-trips a private key', async () => {
    const pair = await generateOaepKeyPair()
    const exported = await exportOaepKey(pair.privateKey, 'private')
    const imported = await importOaepPrivateKey(exported)
    const reExported = await exportOaepKey(imported, 'private')
    expect(reExported).toBe(exported)
  })

  it('exported keys are base64url strings', async () => {
    const pair = await generateOaepKeyPair()
    const pubB64 = await exportOaepKey(pair.publicKey, 'public')
    const privB64 = await exportOaepKey(pair.privateKey, 'private')
    expect(pubB64).not.toMatch(/[+/=]/)
    expect(privB64).not.toMatch(/[+/=]/)
  })

  it('imported public key retains encrypt usage', async () => {
    const pair = await generateOaepKeyPair()
    const exported = await exportOaepKey(pair.publicKey, 'public')
    const imported = await importOaepPublicKey(exported)
    expect(imported.usages).toContain('encrypt')
  })

  it('imported private key retains decrypt usage', async () => {
    const pair = await generateOaepKeyPair()
    const exported = await exportOaepKey(pair.privateKey, 'private')
    const imported = await importOaepPrivateKey(exported)
    expect(imported.usages).toContain('decrypt')
  })
})

describe('wrapRoomKey / unwrapRoomKey', () => {
  it('round-trips a room key', async () => {
    const oaepPair = await generateOaepKeyPair()
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, oaepPair.publicKey)
    const unwrapped = await unwrapRoomKey(wrapped, oaepPair.privateKey)
    const originalExport = await exportRoomKey(roomKey)
    const roundTripExport = await exportRoomKey(unwrapped)
    expect(roundTripExport).toBe(originalExport)
  })

  it('wrapped key is a base64url string', async () => {
    const oaepPair = await generateOaepKeyPair()
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, oaepPair.publicKey)
    expect(typeof wrapped).toBe('string')
    expect(wrapped).not.toMatch(/[+/=]/)
  })

  it('unwrapped key has correct algorithm', async () => {
    const oaepPair = await generateOaepKeyPair()
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, oaepPair.publicKey)
    const unwrapped = await unwrapRoomKey(wrapped, oaepPair.privateKey)
    expect(unwrapped.algorithm.name).toBe('AES-GCM')
  })

  it('unwrapped key has correct usages', async () => {
    const oaepPair = await generateOaepKeyPair()
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, oaepPair.publicKey)
    const unwrapped = await unwrapRoomKey(wrapped, oaepPair.privateKey)
    expect(unwrapped.usages).toContain('encrypt')
    expect(unwrapped.usages).toContain('decrypt')
  })

  it('fails with wrong private key', async () => {
    const oaepPair1 = await generateOaepKeyPair()
    const oaepPair2 = await generateOaepKeyPair()
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, oaepPair1.publicKey)
    await expect(unwrapRoomKey(wrapped, oaepPair2.privateKey)).rejects.toThrow()
  })

  it('wrapping the same key twice produces different ciphertexts (OAEP padding)', async () => {
    const oaepPair = await generateOaepKeyPair()
    const roomKey = await generateRoomKey()
    const wrapped1 = await wrapRoomKey(roomKey, oaepPair.publicKey)
    const wrapped2 = await wrapRoomKey(roomKey, oaepPair.publicKey)
    expect(wrapped1).not.toBe(wrapped2)
  })

  it('works with re-imported OAEP keys', async () => {
    const oaepPair = await generateOaepKeyPair()
    const pubB64 = await exportOaepKey(oaepPair.publicKey, 'public')
    const privB64 = await exportOaepKey(oaepPair.privateKey, 'private')
    const importedPub = await importOaepPublicKey(pubB64)
    const importedPriv = await importOaepPrivateKey(privB64)
    const roomKey = await generateRoomKey()
    const wrapped = await wrapRoomKey(roomKey, importedPub)
    const unwrapped = await unwrapRoomKey(wrapped, importedPriv)
    expect(await exportRoomKey(unwrapped)).toBe(await exportRoomKey(roomKey))
  })
})
