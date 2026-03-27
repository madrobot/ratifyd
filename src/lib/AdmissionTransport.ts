import type { Awareness } from 'y-protocols/awareness'
import type { Role } from '../constants'

export type AdmissionMessage =
  | {
      type: 'admission-request'
      token: string
      signingPubKeyB64: string
      oaepPubKeyB64: string | null
    }
  | { type: 'admission-nonce'; forPeerId: string; nonce: string }
  | { type: 'admission-response'; token: string; signatureB64: string }
  | { type: 'admission-granted'; forPeerId: string; wrappedRoomKey: string | null }

export class AdmissionTransport {
  #awareness: Awareness
  #teardown: (() => void)[]

  constructor(awareness: Awareness) {
    this.#awareness = awareness
    this.#teardown = []
  }

  /** Send a message from this peer (sets 'adm' awareness field) */
  send(msg: AdmissionMessage): void {
    this.#awareness.setLocalStateField('adm', msg)
  }

  /**
   * Register a handler for incoming admission messages.
   * Handler fires for ALL adm messages from other peers (not just ones addressed to this peer).
   * Caller is responsible for filtering by forPeerId if needed.
   * Returns an unsubscribe function.
   */
  onMessage(handler: (msg: AdmissionMessage, fromClientId: number) => void): () => void {
    const listener = () => {
      const states = this.#awareness.getStates()
      for (const [clientId, state] of states) {
        if (clientId === this.#awareness.clientID) continue
        const adm = (state as Record<string, unknown>).adm as AdmissionMessage | undefined
        if (!adm?.type) continue
        handler(adm, clientId)
      }
    }
    this.#awareness.on('change', listener)
    const unsub = () => this.#awareness.off('change', listener)
    this.#teardown.push(unsub)
    return unsub
  }

  /** Check if any peer with the given role is in awareness */
  hasOnlinePeer(role: Role): boolean {
    const states = this.#awareness.getStates()
    return [...states.values()].some((s) => (s as Record<string, unknown>).role === role)
  }

  get clientId(): number {
    return this.#awareness.clientID
  }

  destroy(): void {
    for (const unsub of this.#teardown) unsub()
    this.#teardown = []
  }
}
