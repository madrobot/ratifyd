import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import { ROLES, SIGNALING_SERVERS, STORAGE_KEYS, YJS_ROOM_PREFIX } from '../constants'
import { Claim } from './Claim'
import { base64urlToBuffer, bufferToBase64url } from './helper'
import { Identity } from './Identity'
import { SelfSovereignPKI } from './SelfSovereignPKI'
import { State } from './State'
import { AuthError } from './error/AuthError'

export interface EncryptedBlob {
  iv: string
  ciphertext: string
}

export class Room {
  #id: string
  #webrtc: WebrtcProvider
  #protocol: SelfSovereignPKI
  #state: State

  #owner: Identity | undefined
  #roomKey: CryptoKey | undefined

  #teardown: Array<() => Promise<void>> = []

  private constructor(webrtc: WebrtcProvider) {
    this.#id = crypto.randomUUID()
    this.#webrtc = webrtc
    this.#protocol = new SelfSovereignPKI()
    this.#state = new State(webrtc.doc)
  }

  // ---- ENTRY POINT HERE ----
  // TODO: implement
  static async create(): Promise<Room> {
    // TODO: should we create providers here too? And give destroy hooks back to react?
    const room = new Room(webrtc)
    room.#owner = (await Identity.load()) ?? (await (await Identity.create()).save())
    room.#roomKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]) // TODO: should save this? To local storage? Wrapped?

    const claim = await room.#owner.mintClaim(room.#owner.id, room.#id, ROLES.OWNER, room.#owner.id)

    const signingPublicKeyB64 = await room.#owner.getSigningPublicKeyB64()

    if (!(await room.#protocol.requestAdmission(claim.raw, signingPublicKeyB64)))
      throw new AuthError('Could not create room due to auth protocol error')

    room.#state.addPeer(claim, signingPublicKeyB64)

    // TODO: Change URL to /#token=...

    return room
  }

  // TODO: ??? implement
  static async preview(token: string) {
    const room = new Room(webrtc)
    room.#id = await Claim.peek(token, 'room')
    // TODO: room owner is unknown at this point
  }

  async join(
    token: string,
    peerSigningPublicKey?: string,
    nonceSignature?: string,
  ): Promise<{ nonce: string } | Room> {
    const localIdentity = (await Identity.load()) ?? (await (await Identity.create()).save())
    const iss = await Claim.peek(token, 'iss')
    const issuerSigningPublicKey = this.#state.getIssuerSigningPublicKey(iss)
    const knownPeerSigningPublicKey = this.#state.getInviteSigningPublicKey(
      await Claim.peek(token, 'jti'),
    )

    let authRes: { nonce: string } | true
    if (peerSigningPublicKey && nonceSignature)
      authRes = await this.#protocol.respondToChallenge(
        token,
        issuerSigningPublicKey,
        peerSigningPublicKey,
        nonceSignature,
        knownPeerSigningPublicKey,
      )
    else authRes = await this.#protocol.requestAdmission(token, issuerSigningPublicKey)

    if (authRes !== true) return authRes

    const claim = await Claim.verify(
      token,
      await Identity.importSigningPublicKey(issuerSigningPublicKey!),
    )

    // TODO lets create room
    // TODO: should we create providers here too? And give destroy hooks back to react?
    const room = new Room(webrtc)
    if (localIdentity.id === iss) room.#owner = localIdentity
    // TODO: should load room key from local storage? Unwrap?
    room.#state.addPeer(
      claim,
      knownPeerSigningPublicKey ??
        peerSigningPublicKey ??
        (await localIdentity.getSigningPublicKeyB64()),
    )

    // TODO is that all?
  }

  // ???????? is this needed????
  async save() {
    if (!this.#owner || !this.#roomKey) throw new Error('Room not initialized')
    localStorage.setItem(STORAGE_KEYS.PEER_ID, this.#owner) // TODO: don't use .toString
    localStorage.setItem(
      `${STORAGE_KEYS.ROOM_KEY}:${this.id}`,
      bufferToBase64url(await crypto.subtle.exportKey('raw', this.#roomKey)), // TODO: MUST WRAP BEFORE STORING
    )
    // save to localStorage
  }

  // ???????? is this needed????
  static async load(roomId: string): Promise<Room> {
    // ?????? needed????
    // load from localStorage
    // return new Room()
    return {} as Room
  }

  // ALWAYS WRAPPED KEY, NEVER RAW KEY
  async key(oaepPublicKey: CryptoKey): Promise<string> {
    if (!this.#roomKey) throw new Error('Room key not initialized')
    const rawKey = await crypto.subtle.exportKey('raw', this.#roomKey)
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, oaepPublicKey, rawKey)
    return bufferToBase64url(wrapped)
  }

  // ???????????? needed ????
  static async unwrapRoomKey(wrappedKeyB64: string, oaepPrivateKey: CryptoKey): Promise<CryptoKey> {
    const wrapped = base64urlToBuffer(wrappedKeyB64)
    const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, oaepPrivateKey, wrapped)
    return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
  }

  async encrypt(data: string): Promise<EncryptedBlob> {
    if (!this.#roomKey) throw new Error('Room key not initialized')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const encoded = new TextEncoder().encode(data)
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.#roomKey, encoded)
    return {
      iv: bufferToBase64url(iv.buffer),
      ciphertext: bufferToBase64url(encrypted),
    }
  }

  async decrypt(blob: EncryptedBlob): Promise<string> {
    if (!this.#roomKey) throw new Error('Room key not initialized')
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64urlToBuffer(blob.iv) },
      this.#roomKey,
      base64urlToBuffer(blob.ciphertext),
    )
    return new TextDecoder().decode(decrypted)
  }

  destroy(): void {
    this.#protocol.destroy()
  }
}
