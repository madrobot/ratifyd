import { Claim } from './Claim'
import { Identity } from './Identity'
import { SessionKey } from './SessionKey'
import { SelfSovereignPKI } from './SelfSovereignPKI'
import { State } from './State'
import { ROLES } from '../constants'
import { bufferToBase64url } from './helper'
import type { AdmittedPeer, RoomStatus } from './Room'

// ── Transport interface ───────────────────────────────────────────────────────

/**
 * Narrow interface over a y-webrtc Awareness object (or any equivalent channel)
 * used to exchange admission protocol messages between peers.
 */
export interface AdmissionTransport {
  readonly clientID: number
  getStates(): Map<number, unknown>
  setLocalStateField(field: string, value: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
}

// ── Callbacks interface ───────────────────────────────────────────────────────

export interface AdmissionCoordinatorCallbacks {
  /** Called on the peer side when admission is granted (null if no session key — e.g. guest). */
  onAdmitted: (sessionKey: SessionKey | null) => void
  /** Called on the owner side when a remote peer has been admitted. */
  onPeerAdmitted: (info: AdmittedPeer) => void
  /** Called whenever the admission protocol transitions to a new status. */
  onStatusChange: (status: RoomStatus) => void
  /** Called when an unexpected error occurs that should surface to the room owner. */
  onError: (err: Error) => void
}

// ── AdmissionCoordinator ──────────────────────────────────────────────────────

/**
 * Encapsulates the admission state machine for a Ratifyd room.
 *
 * The admission protocol is a two-step challenge-response:
 *   1. A peer broadcasts an `admission-request` with their JWT token and public keys.
 *   2. The owner (or moderator acting as admitter) sends back an `admission-nonce`.
 *   3. The peer signs the nonce and broadcasts an `admission-response`.
 *   4. The owner verifies the signature, calls `State.addPeer`, and sends `admission-granted`
 *      with an optional wrapped session key (moderators only).
 *
 * This class is NOT responsible for setting `Room.#status` directly — it calls
 * `callbacks.onStatusChange` and lets Room decide what to do with it.
 */
export class AdmissionCoordinator {
  #transport: AdmissionTransport
  #protocol: SelfSovereignPKI
  #state: State
  #identity: Identity
  #callbacks: AdmissionCoordinatorCallbacks
  #pendingAdmission: Map<
    string,
    { token: string; signingPubKeyB64: string; oaepPubKeyB64: string | null }
  >
  #teardown: (() => void)[]
  /**
   * Internal status mirror so the awaiting-owner watch handler can decide whether
   * to send the admission request without calling back into Room.
   */
  #awaitingStatus: 'awaiting' | 'connecting' | null = null

  constructor(
    transport: AdmissionTransport,
    protocol: SelfSovereignPKI,
    state: State,
    identity: Identity,
    callbacks: AdmissionCoordinatorCallbacks,
  ) {
    this.#transport = transport
    this.#protocol = protocol
    this.#state = state
    this.#identity = identity
    this.#callbacks = callbacks
    this.#pendingAdmission = new Map()
    this.#teardown = []
  }

  // ── Owner-side handler ──────────────────────────────────────────────────────

  /**
   * Register awareness-change handlers for admitting incoming peers.
   *
   * `sessionKey` is null when the coordinator belongs to a moderator who does not
   * yet have a key (they are being admitted themselves at the same time they might
   * need to admit others). In that case, key-wrapping is skipped even for moderator
   * roles since there is nothing to wrap.
   */
  setupOwnerHandlers(sessionKey: SessionKey | null): void {
    const myClientId = this.#transport.clientID
    const handler = async () => {
      const states = this.#transport.getStates()
      for (const [clientId, state] of states) {
        if (clientId === myClientId) continue
        const adm = (state as Record<string, unknown>).adm as Record<string, unknown> | undefined
        if (!adm) continue

        if (adm.type === 'admission-request') {
          const admToken = adm.token as string
          const signingPubKeyB64 = adm.signingPubKeyB64 as string
          const oaepPubKeyB64 = adm.oaepPubKeyB64 as string | null
          const iss = await Claim.peek(admToken, 'iss')
          const issuerKeyB64 = this.#state.getIssuerSigningPublicKey(iss)
          if (!issuerKeyB64) continue
          try {
            const { nonce } = await this.#protocol.requestAdmission(admToken, issuerKeyB64)
            this.#transport.setLocalStateField('adm', {
              type: 'admission-nonce',
              forPeerId: String(clientId),
              nonce,
            })
            this.#pendingAdmission.set(String(clientId), {
              token: admToken,
              signingPubKeyB64,
              oaepPubKeyB64,
            })
          } catch {
            /* invalid token — ignore */
          }
        } else if (adm.type === 'admission-response') {
          const admToken = adm.token as string
          const signatureB64 = adm.signatureB64 as string
          const pending = this.#pendingAdmission.get(String(clientId))
          if (!pending || pending.token !== admToken) continue
          const iss = await Claim.peek(admToken, 'iss')
          const issuerKeyB64 = this.#state.getIssuerSigningPublicKey(iss)
          if (!issuerKeyB64) continue // unknown issuer at response time, ignore
          const knownPubKey = this.#state.getInviteSigningPublicKey(
            await Claim.peek(admToken, 'jti'),
          )
          try {
            await this.#protocol.respondToChallenge(
              admToken,
              issuerKeyB64,
              pending.signingPubKeyB64,
              signatureB64,
              knownPubKey,
            )
            const claim = await Claim.verify(
              admToken,
              await Identity.importSigningPublicKey(issuerKeyB64),
            )
            this.#state.addPeer(claim, pending.signingPubKeyB64)
            this.#callbacks.onPeerAdmitted({
              peerId: String(clientId),
              role: claim.role,
              admittedAt: Date.now(),
            })
            let wrappedRoomKey: string | null = null
            if (claim.role === ROLES.MODERATOR && pending.oaepPubKeyB64 && sessionKey) {
              const oaepPubKey = await Identity.importOaepPublicKey(pending.oaepPubKeyB64)
              wrappedRoomKey = await sessionKey.wrapFor(oaepPubKey)
            }
            this.#transport.setLocalStateField('adm', {
              type: 'admission-granted',
              forPeerId: String(clientId),
              wrappedRoomKey,
            })
            this.#pendingAdmission.delete(String(clientId))
          } catch {
            /* invalid signature — ignore */
          }
        }
      }
    }
    this.#transport.on('change', handler)
    this.#teardown.push(() => {
      this.#transport.off('change', handler)
    })

    // Prune stale pending admission entries when a peer departs so the map
    // does not grow unboundedly in long-lived owner rooms.
    const departureHandler = ({ removed }: { removed?: number[] }) => {
      if (!removed) return
      for (const clientId of removed) {
        this.#pendingAdmission.delete(String(clientId))
      }
    }
    this.#transport.on('change', departureHandler)
    this.#teardown.push(() => this.#transport.off('change', departureHandler))
  }

  // ── Peer-side handler ───────────────────────────────────────────────────────

  /**
   * Register awareness-change handlers for the peer being admitted.
   *
   * The peer listens for:
   *  - `admission-nonce` addressed to their clientID → sign and send response
   *  - `admission-granted` addressed to their clientID → unwrap key, call onAdmitted
   */
  setupPeerHandlers(token: string): void {
    const myClientId = this.#transport.clientID
    const handler = async (_: unknown, origin: unknown) => {
      if (origin === 'local') return
      const states = this.#transport.getStates()
      for (const [clientId, state] of states) {
        if (clientId === myClientId) continue
        const adm = (state as Record<string, unknown>).adm as Record<string, unknown> | undefined
        if (!adm) continue

        if (adm.type === 'admission-nonce' && adm.forPeerId === String(myClientId)) {
          const nonce = adm.nonce as string
          const sig = await this.#identity.sign(nonce)
          this.#transport.setLocalStateField('adm', {
            type: 'admission-response',
            token,
            signatureB64: bufferToBase64url(sig),
          })
        } else if (adm.type === 'admission-granted' && adm.forPeerId === String(myClientId)) {
          const wrappedRoomKey = adm.wrappedRoomKey as string | null
          let sessionKey: SessionKey | null = null
          if (wrappedRoomKey) {
            sessionKey = await this.#identity.unwrapToSessionKey(wrappedRoomKey)
          }
          this.#callbacks.onAdmitted(sessionKey)
          this.#callbacks.onStatusChange('connected')
        }
      }
    }
    this.#transport.on('change', handler)
    this.#teardown.push(() => {
      this.#transport.off('change', handler)
    })
  }

  // ── Admission request ───────────────────────────────────────────────────────

  /** Broadcast an admission-request on the transport channel. */
  async sendAdmissionRequest(token: string): Promise<void> {
    const state = {
      type: 'admission-request',
      token,
      signingPubKeyB64: await this.#identity.getSigningPublicKeyB64(),
      oaepPubKeyB64: await this.#identity.getOaepPublicKeyB64(),
    }
    this.#transport.setLocalStateField('adm', state)
  }

  // ── Awaiting owner watch ────────────────────────────────────────────────────

  /**
   * Watch for the owner to come online and send an admission request once they do.
   * This is used when the peer joins before the owner is present in awareness.
   */
  setupAwaitingOwnerWatch(token: string): void {
    this.#awaitingStatus = 'awaiting'
    const handler = async () => {
      if (this.#awaitingStatus !== 'awaiting') return
      if (this.#isOwnerOnline()) {
        this.#awaitingStatus = 'connecting'
        this.#callbacks.onStatusChange('connecting')
        await this.sendAdmissionRequest(token)
      }
    }
    this.#transport.on('change', handler)
    this.#teardown.push(() => {
      this.#transport.off('change', handler)
    })
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  /** Unregister all transport handlers registered by this coordinator. */
  destroy(): void {
    for (const cleanup of this.#teardown) cleanup()
    this.#teardown = []
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  #isOwnerOnline(): boolean {
    const states = this.#transport.getStates()
    return [...states.values()].some((s) => (s as Record<string, unknown>)['role'] === ROLES.OWNER)
  }
}
