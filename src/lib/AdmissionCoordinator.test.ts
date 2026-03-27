import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AdmissionCoordinator } from './AdmissionCoordinator'
import type { AdmissionTransport, AdmissionCoordinatorCallbacks } from './AdmissionCoordinator'
import { Identity } from './Identity'
import { SelfSovereignPKI } from './SelfSovereignPKI'
import { SessionKey } from './SessionKey'
import { State } from './State'
import { ROLES } from '../constants'
import { bufferToBase64url } from './helper'
import * as Y from 'yjs'

// ── Fake transport ────────────────────────────────────────────────────────────

/**
 * A minimal fake AdmissionTransport backed by a simple event-emitter.
 * Tracks setLocalStateField calls and lets tests simulate awareness changes.
 */
class FakeTransport implements AdmissionTransport {
  readonly clientID: number
  #states: Map<number, unknown>
  #handlers: Map<string, Set<(...args: unknown[]) => void>>
  readonly localStateFields: Array<{ field: string; value: unknown }>

  constructor(clientID: number, initialStates?: Map<number, unknown>) {
    this.clientID = clientID
    this.#states = initialStates ?? new Map()
    this.#handlers = new Map()
    this.localStateFields = []
  }

  getStates(): Map<number, unknown> {
    return this.#states
  }

  setLocalStateField(field: string, value: unknown): void {
    this.localStateFields.push({ field, value })
    // Also update our own state entry so handlers see our state
    const current = (this.#states.get(this.clientID) as Record<string, unknown>) ?? {}
    this.#states.set(this.clientID, { ...current, [field]: value })
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set())
    this.#handlers.get(event)!.add(handler)
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.#handlers.get(event)?.delete(handler)
  }

  /** Test helper: simulate an awareness change event. Awaits all async handlers. */
  async simulateChange(changeData: unknown = {}): Promise<void> {
    const handlers = this.#handlers.get('change')
    if (!handlers) return
    const results: unknown[] = []
    for (const h of handlers) results.push(h(changeData))
    // Await any promises returned by async handlers
    await Promise.all(results.filter((r) => r instanceof Promise))
  }

  /** Test helper: update a remote peer's state in the fake awareness map. */
  setRemoteState(clientID: number, state: unknown): void {
    this.#states.set(clientID, state)
  }

  /** Test helper: remove a peer from awareness. */
  removeRemoteState(clientID: number): void {
    this.#states.delete(clientID)
  }

  /** Test helper: how many handlers are registered for an event */
  handlerCount(event: string): number {
    return this.#handlers.get(event)?.size ?? 0
  }
}

// ── Test setup helpers ────────────────────────────────────────────────────────

function makeCallbacks(): AdmissionCoordinatorCallbacks & {
  admitted: Array<SessionKey | null>
  peerAdmitted: Array<{ peerId: string; role: string; admittedAt: number }>
  statusChanges: string[]
  errors: Error[]
} {
  const admitted: Array<SessionKey | null> = []
  const peerAdmitted: Array<{ peerId: string; role: string; admittedAt: number }> = []
  const statusChanges: string[] = []
  const errors: Error[] = []
  return {
    admitted,
    peerAdmitted,
    statusChanges,
    errors,
    onAdmitted: (sk) => admitted.push(sk),
    onPeerAdmitted: (info) => peerAdmitted.push(info),
    onStatusChange: (s) => statusChanges.push(s),
    onError: (e) => errors.push(e),
  }
}

function makeState(): { state: State; doc: Y.Doc } {
  const doc = new Y.Doc()
  const state = new State(doc)
  return { state, doc }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// ── Test 1: Owner side — admission-request → nonce → admission-response → onPeerAdmitted ─────

describe('AdmissionCoordinator: owner side — guest admission flow', () => {
  it('processes admission-request, emits nonce, processes response, calls onPeerAdmitted with guest role', async () => {
    // Create owner identity and register them in state
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()
    const sessionKey = await SessionKey.generate()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    // Owner transport (clientID 1), peer transport (clientID 2)
    const ownerTransport = new FakeTransport(1)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      ownerTransport,
      protocol,
      state,
      ownerIdentity,
      callbacks,
    )
    coordinator.setupOwnerHandlers(sessionKey)

    // Create guest identity and their token
    const guestIdentity = await Identity.create()
    const guestPubB64 = await guestIdentity.getSigningPublicKeyB64()
    const guestToken = (
      await ownerIdentity.mintClaim(guestIdentity.id, roomId, ROLES.GUEST, ownerIdentity.id)
    ).raw

    // Peer sends admission-request (no oaepPubKeyB64 for guest)
    ownerTransport.setRemoteState(2, {
      adm: {
        type: 'admission-request',
        token: guestToken,
        signingPubKeyB64: guestPubB64,
        oaepPubKeyB64: null,
      },
    })
    await ownerTransport.simulateChange()

    // Owner should have sent admission-nonce
    const nonceFields = ownerTransport.localStateFields.filter(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-nonce',
    )
    expect(nonceFields).toHaveLength(1)
    const nonceState = nonceFields[0].value as { type: string; forPeerId: string; nonce: string }
    expect(nonceState.forPeerId).toBe('2')
    expect(typeof nonceState.nonce).toBe('string')

    // Peer signs the nonce
    const sig = bufferToBase64url(await guestIdentity.sign(nonceState.nonce))

    // Peer sends admission-response
    ownerTransport.setRemoteState(2, {
      adm: {
        type: 'admission-response',
        token: guestToken,
        signatureB64: sig,
      },
    })
    await ownerTransport.simulateChange()

    // Owner should have granted admission
    const grantedFields = ownerTransport.localStateFields.filter(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-granted',
    )
    expect(grantedFields).toHaveLength(1)
    const grantedState = grantedFields[0].value as {
      type: string
      forPeerId: string
      wrappedRoomKey: string | null
    }
    expect(grantedState.forPeerId).toBe('2')
    // Guest gets null wrappedRoomKey
    expect(grantedState.wrappedRoomKey).toBeNull()

    // onPeerAdmitted called with guest role
    expect(callbacks.peerAdmitted).toHaveLength(1)
    expect(callbacks.peerAdmitted[0].role).toBe(ROLES.GUEST)
    expect(callbacks.peerAdmitted[0].peerId).toBe('2')

    // onAdmitted NOT called for owner-side handling
    expect(callbacks.admitted).toHaveLength(0)

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })
})

// ── Test 2: Owner side — moderator gets wrapped session key ───────────────────

describe('AdmissionCoordinator: owner side — moderator admission flow', () => {
  it('wraps and delivers session key for moderator role', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()
    const sessionKey = await SessionKey.generate()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    const ownerTransport = new FakeTransport(1)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      ownerTransport,
      protocol,
      state,
      ownerIdentity,
      callbacks,
    )
    coordinator.setupOwnerHandlers(sessionKey)

    // Moderator identity with OAEP key
    const modIdentity = await Identity.create(undefined, true)
    const modPubB64 = await modIdentity.getSigningPublicKeyB64()
    const modOaepPubB64 = await modIdentity.getOaepPublicKeyB64()
    const modToken = (
      await ownerIdentity.mintClaim(modIdentity.id, roomId, ROLES.MODERATOR, ownerIdentity.id)
    ).raw

    ownerTransport.setRemoteState(2, {
      adm: {
        type: 'admission-request',
        token: modToken,
        signingPubKeyB64: modPubB64,
        oaepPubKeyB64: modOaepPubB64,
      },
    })
    await ownerTransport.simulateChange()

    // Get nonce
    const nonceState = ownerTransport.localStateFields.find(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-nonce',
    )?.value as { nonce: string }
    expect(nonceState).toBeDefined()

    // Sign and respond
    const sig = bufferToBase64url(await modIdentity.sign(nonceState.nonce))
    ownerTransport.setRemoteState(2, {
      adm: {
        type: 'admission-response',
        token: modToken,
        signatureB64: sig,
      },
    })
    await ownerTransport.simulateChange()

    // Owner should have sent wrapped room key for moderator
    const grantedState = ownerTransport.localStateFields.find(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-granted',
    )?.value as { forPeerId: string; wrappedRoomKey: string | null }

    expect(grantedState).toBeDefined()
    expect(grantedState.forPeerId).toBe('2')
    // Moderator gets a non-null wrapped key
    expect(typeof grantedState.wrappedRoomKey).toBe('string')
    expect(grantedState.wrappedRoomKey!.length).toBeGreaterThan(0)

    // Verify moderator can unwrap it
    const unwrapped = await modIdentity.unwrapToSessionKey(grantedState.wrappedRoomKey!)
    expect(unwrapped).toBeInstanceOf(SessionKey)

    // onPeerAdmitted called with moderator role
    expect(callbacks.peerAdmitted).toHaveLength(1)
    expect(callbacks.peerAdmitted[0].role).toBe(ROLES.MODERATOR)

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })
})

// ── Test 3: Owner side — unknown issuer silently ignored ──────────────────────

describe('AdmissionCoordinator: owner side — unknown issuer', () => {
  it('silently ignores admission-request when issuer is unknown', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()
    const sessionKey = await SessionKey.generate()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    const ownerTransport = new FakeTransport(1)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      ownerTransport,
      protocol,
      state,
      ownerIdentity,
      callbacks,
    )
    coordinator.setupOwnerHandlers(sessionKey)

    // Unknown issuer — token signed by an unknown identity
    const unknownIssuer = await Identity.create()
    const peerIdentity = await Identity.create()
    const peerPubB64 = await peerIdentity.getSigningPublicKeyB64()
    // Token signed by unknownIssuer — NOT registered in state
    const unknownToken = (
      await unknownIssuer.mintClaim(peerIdentity.id, roomId, ROLES.GUEST, unknownIssuer.id)
    ).raw

    ownerTransport.setRemoteState(2, {
      adm: {
        type: 'admission-request',
        token: unknownToken,
        signingPubKeyB64: peerPubB64,
        oaepPubKeyB64: null,
      },
    })
    await ownerTransport.simulateChange()

    // No nonce should have been sent
    const nonceFields = ownerTransport.localStateFields.filter(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-nonce',
    )
    expect(nonceFields).toHaveLength(0)

    // No callbacks
    expect(callbacks.peerAdmitted).toHaveLength(0)
    expect(callbacks.errors).toHaveLength(0)

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })
})

// ── Test 4: Peer side — receives nonce → signs → sends admission-response ─────

describe('AdmissionCoordinator: peer side — nonce response', () => {
  it('signs the nonce and sends admission-response when nonce is received', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    // Peer transport (clientID 2)
    const peerTransport = new FakeTransport(2)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const peerIdentity = await Identity.create()
    const guestToken = (
      await ownerIdentity.mintClaim(peerIdentity.id, roomId, ROLES.GUEST, ownerIdentity.id)
    ).raw

    const coordinator = new AdmissionCoordinator(
      peerTransport,
      protocol,
      state,
      peerIdentity,
      callbacks,
    )
    coordinator.setupPeerHandlers(guestToken)

    // Owner sends a nonce targeting this peer (clientID 2)
    const nonce = 'test-nonce-abc123'
    peerTransport.setRemoteState(1, {
      adm: {
        type: 'admission-nonce',
        forPeerId: '2',
        nonce,
      },
    })
    await peerTransport.simulateChange()

    // Peer should have sent admission-response
    const responseFields = peerTransport.localStateFields.filter(
      (f) =>
        f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-response',
    )
    expect(responseFields).toHaveLength(1)
    const responseState = responseFields[0].value as {
      type: string
      token: string
      signatureB64: string
    }
    expect(responseState.token).toBe(guestToken)
    expect(typeof responseState.signatureB64).toBe('string')
    expect(responseState.signatureB64.length).toBeGreaterThan(0)

    // Verify the signature was actually signed with the peer's key
    const sigBuf = Uint8Array.from(
      atob(responseState.signatureB64.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    ).buffer
    const verified = await peerIdentity.verify(sigBuf, nonce)
    expect(verified).toBe(true)

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })
})

// ── Test 5: Peer side — admission-granted with wrapped key → onAdmitted(sessionKey) ──

describe('AdmissionCoordinator: peer side — admission-granted', () => {
  it('calls onAdmitted with non-null SessionKey when admission-granted carries wrappedRoomKey', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    // Moderator peer with OAEP key
    const modIdentity = await Identity.create(undefined, true)
    const modToken = (
      await ownerIdentity.mintClaim(modIdentity.id, roomId, ROLES.MODERATOR, ownerIdentity.id)
    ).raw

    const peerTransport = new FakeTransport(2)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      peerTransport,
      protocol,
      state,
      modIdentity,
      callbacks,
    )
    coordinator.setupPeerHandlers(modToken)

    // Create a real session key and wrap it for the moderator
    const sessionKey = await SessionKey.generate()
    const modOaepPubKey = modIdentity.oaepPublicKey!
    const wrappedRoomKey = await sessionKey.wrapFor(modOaepPubKey)

    // Owner sends admission-granted with wrapped key
    peerTransport.setRemoteState(1, {
      adm: {
        type: 'admission-granted',
        forPeerId: '2',
        wrappedRoomKey,
      },
    })
    await peerTransport.simulateChange()

    // onAdmitted should be called with a non-null SessionKey
    expect(callbacks.admitted).toHaveLength(1)
    expect(callbacks.admitted[0]).toBeInstanceOf(SessionKey)

    // onStatusChange should be called with 'connected'
    expect(callbacks.statusChanges).toContain('connected')

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })

  it('calls onAdmitted with null when admission-granted has no wrappedRoomKey (guest)', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    const guestIdentity = await Identity.create()
    const guestToken = (
      await ownerIdentity.mintClaim(guestIdentity.id, roomId, ROLES.GUEST, ownerIdentity.id)
    ).raw

    const peerTransport = new FakeTransport(2)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      peerTransport,
      protocol,
      state,
      guestIdentity,
      callbacks,
    )
    coordinator.setupPeerHandlers(guestToken)

    // Owner sends admission-granted without wrapped key
    peerTransport.setRemoteState(1, {
      adm: {
        type: 'admission-granted',
        forPeerId: '2',
        wrappedRoomKey: null,
      },
    })
    await peerTransport.simulateChange()

    // onAdmitted called with null (no session key for guests)
    expect(callbacks.admitted).toHaveLength(1)
    expect(callbacks.admitted[0]).toBeNull()

    // onStatusChange still called with 'connected'
    expect(callbacks.statusChanges).toContain('connected')

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })
})

// ── Test 6: awaiting watch — calls sendAdmissionRequest once owner appears ────

describe('AdmissionCoordinator: setupAwaitingOwnerWatch', () => {
  it('sends admission request once owner appears in awareness', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    const guestIdentity = await Identity.create()
    const guestPubB64 = await guestIdentity.getSigningPublicKeyB64()
    const guestToken = (
      await ownerIdentity.mintClaim(guestIdentity.id, roomId, ROLES.GUEST, ownerIdentity.id)
    ).raw

    // Start with empty awareness (owner offline)
    const peerTransport = new FakeTransport(2)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      peerTransport,
      protocol,
      state,
      guestIdentity,
      callbacks,
    )

    // Set status to 'awaiting' via the watch
    callbacks.statusChanges.push('awaiting') // simulate Room setting initial status

    // Start the awaiting watch
    coordinator.setupAwaitingOwnerWatch(guestToken)

    // No admission request yet (owner offline)
    expect(peerTransport.localStateFields).toHaveLength(0)

    // Owner comes online
    peerTransport.setRemoteState(1, { role: ROLES.OWNER, adm: null })
    await peerTransport.simulateChange()

    // Now admission request should be sent
    const admReqFields = peerTransport.localStateFields.filter(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-request',
    )
    expect(admReqFields).toHaveLength(1)
    const admReqState = admReqFields[0].value as {
      type: string
      token: string
      signingPubKeyB64: string
    }
    expect(admReqState.token).toBe(guestToken)
    expect(admReqState.signingPubKeyB64).toBe(guestPubB64)

    // Status should have changed to 'connecting'
    expect(callbacks.statusChanges).toContain('connecting')

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })

  it('does not send a second admission request if owner fires change again after already connecting', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    const guestIdentity = await Identity.create()
    const guestToken = (
      await ownerIdentity.mintClaim(guestIdentity.id, roomId, ROLES.GUEST, ownerIdentity.id)
    ).raw

    const peerTransport = new FakeTransport(2)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      peerTransport,
      protocol,
      state,
      guestIdentity,
      callbacks,
    )
    coordinator.setupAwaitingOwnerWatch(guestToken)

    // First change — owner appears, should send admission request
    peerTransport.setRemoteState(1, { role: ROLES.OWNER })
    await peerTransport.simulateChange()

    const admReqFieldsAfterFirst = peerTransport.localStateFields.filter(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-request',
    )
    expect(admReqFieldsAfterFirst).toHaveLength(1)
    // Status should have changed to 'connecting'
    expect(callbacks.statusChanges).toContain('connecting')

    // Second change — should NOT fire again (status is now 'connecting', not 'awaiting')
    await peerTransport.simulateChange()

    const admReqFieldsAfterSecond = peerTransport.localStateFields.filter(
      (f) => f.field === 'adm' && (f.value as Record<string, unknown>).type === 'admission-request',
    )
    // Still only 1 admission request sent
    expect(admReqFieldsAfterSecond).toHaveLength(1)

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })
})

// ── Test 7: destroy() unregisters transport handlers ─────────────────────────

describe('AdmissionCoordinator: destroy()', () => {
  it('unregisters transport handlers so no more events are processed after destroy', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()
    const sessionKey = await SessionKey.generate()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    const ownerTransport = new FakeTransport(1)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      ownerTransport,
      protocol,
      state,
      ownerIdentity,
      callbacks,
    )
    coordinator.setupOwnerHandlers(sessionKey)

    // Verify handlers are registered
    expect(ownerTransport.handlerCount('change')).toBeGreaterThan(0)

    // Destroy coordinator
    coordinator.destroy()

    // Handlers should be unregistered
    expect(ownerTransport.handlerCount('change')).toBe(0)

    // Events fired after destroy should NOT be processed
    const guestIdentity = await Identity.create()
    const guestPubB64 = await guestIdentity.getSigningPublicKeyB64()
    const guestToken = (
      await ownerIdentity.mintClaim(guestIdentity.id, roomId, ROLES.GUEST, ownerIdentity.id)
    ).raw

    ownerTransport.setRemoteState(2, {
      adm: {
        type: 'admission-request',
        token: guestToken,
        signingPubKeyB64: guestPubB64,
        oaepPubKeyB64: null,
      },
    })
    ownerTransport.simulateChange()

    // No callbacks should have been called
    expect(callbacks.peerAdmitted).toHaveLength(0)
    expect(ownerTransport.localStateFields.filter((f) => f.field === 'adm')).toHaveLength(0)

    protocol.destroy()
    doc.destroy()
  })

  it('can be called multiple times without throwing', async () => {
    const identity = await Identity.create()
    const { state, doc } = makeState()
    const transport = new FakeTransport(1)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(transport, protocol, state, identity, callbacks)

    expect(() => {
      coordinator.destroy()
      coordinator.destroy()
    }).not.toThrow()

    protocol.destroy()
    doc.destroy()
  })
})

// ── Test: peer-side ignores nonces not meant for this peer ────────────────────

describe('AdmissionCoordinator: peer side — ignores nonces for other peers', () => {
  it('does not respond to nonces addressed to a different peer ID', async () => {
    const ownerIdentity = await Identity.create(undefined, true)
    const ownerPubB64 = await ownerIdentity.getSigningPublicKeyB64()
    const roomId = crypto.randomUUID()

    const { state, doc } = makeState()
    const ownerClaim = await ownerIdentity.mintClaim(
      ownerIdentity.id,
      roomId,
      ROLES.OWNER,
      ownerIdentity.id,
    )
    state.addPeer(ownerClaim, ownerPubB64)

    const peerIdentity = await Identity.create()
    const guestToken = (
      await ownerIdentity.mintClaim(peerIdentity.id, roomId, ROLES.GUEST, ownerIdentity.id)
    ).raw

    // Peer has clientID 3, but nonce is addressed to clientID 99
    const peerTransport = new FakeTransport(3)
    const protocol = new SelfSovereignPKI()
    const callbacks = makeCallbacks()

    const coordinator = new AdmissionCoordinator(
      peerTransport,
      protocol,
      state,
      peerIdentity,
      callbacks,
    )
    coordinator.setupPeerHandlers(guestToken)

    peerTransport.setRemoteState(1, {
      adm: {
        type: 'admission-nonce',
        forPeerId: '99', // not this peer
        nonce: 'some-nonce',
      },
    })
    await peerTransport.simulateChange()

    // Should NOT have responded
    expect(peerTransport.localStateFields).toHaveLength(0)

    coordinator.destroy()
    protocol.destroy()
    doc.destroy()
  })
})
