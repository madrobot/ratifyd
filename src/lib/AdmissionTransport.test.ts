import { describe, it, expect, vi } from 'vitest'
import { AdmissionTransport } from './AdmissionTransport'
import { ROLES } from '../constants'
import type { Awareness } from 'y-protocols/awareness'

type AwarenessHandler = (...args: unknown[]) => void

function makeAwareness(myClientId = 1) {
  const handlers = new Map<string, Set<AwarenessHandler>>()
  return {
    clientID: myClientId,
    getStates: vi.fn().mockReturnValue(new Map()),
    setLocalStateField: vi.fn(),
    on: vi.fn().mockImplementation((evt: string, fn: AwarenessHandler) => {
      if (!handlers.has(evt)) handlers.set(evt, new Set())
      handlers.get(evt)!.add(fn)
    }),
    off: vi.fn().mockImplementation((evt: string, fn: AwarenessHandler) => {
      handlers.get(evt)?.delete(fn)
    }),
    // Helper to fire an event
    emit: (evt: string) => handlers.get(evt)?.forEach((fn) => fn()),
  } as unknown as Awareness & { emit: (evt: string) => void }
}

describe('AdmissionTransport', () => {
  it('send() calls awareness.setLocalStateField with adm field', () => {
    const awareness = makeAwareness()
    const transport = new AdmissionTransport(awareness)
    const msg = {
      type: 'admission-request' as const,
      token: 'tok',
      signingPubKeyB64: 'key',
      oaepPubKeyB64: null,
    }

    transport.send(msg)

    expect(awareness.setLocalStateField).toHaveBeenCalledWith('adm', msg)
  })

  it('onMessage() handler fires when awareness change event fires and another peer has adm field', () => {
    const awareness = makeAwareness(1)
    const peerState = { adm: { type: 'admission-nonce', forPeerId: '1', nonce: 'n123' } }
    awareness.getStates = vi.fn().mockReturnValue(new Map([[2, peerState]]))

    const transport = new AdmissionTransport(awareness)
    const handler = vi.fn()
    transport.onMessage(handler)
    ;(awareness as unknown as { emit: (evt: string) => void }).emit('change')

    expect(handler).toHaveBeenCalledWith(peerState.adm, 2)
  })

  it('onMessage() does NOT fire for this peers own state (clientId filtered)', () => {
    const awareness = makeAwareness(1)
    const myState = {
      adm: {
        type: 'admission-request',
        token: 'tok',
        signingPubKeyB64: 'key',
        oaepPubKeyB64: null,
      },
    }
    awareness.getStates = vi.fn().mockReturnValue(new Map([[1, myState]]))

    const transport = new AdmissionTransport(awareness)
    const handler = vi.fn()
    transport.onMessage(handler)
    ;(awareness as unknown as { emit: (evt: string) => void }).emit('change')

    expect(handler).not.toHaveBeenCalled()
  })

  it('onMessage() does NOT fire when adm field is absent from peer state', () => {
    const awareness = makeAwareness(1)
    const peerState = { role: ROLES.OWNER }
    awareness.getStates = vi.fn().mockReturnValue(new Map([[2, peerState]]))

    const transport = new AdmissionTransport(awareness)
    const handler = vi.fn()
    transport.onMessage(handler)
    ;(awareness as unknown as { emit: (evt: string) => void }).emit('change')

    expect(handler).not.toHaveBeenCalled()
  })

  it('hasOnlinePeer(role) returns true when awareness has a peer with matching role field', () => {
    const awareness = makeAwareness(1)
    const peerState = { role: ROLES.OWNER }
    awareness.getStates = vi.fn().mockReturnValue(new Map([[2, peerState]]))

    const transport = new AdmissionTransport(awareness)

    expect(transport.hasOnlinePeer(ROLES.OWNER)).toBe(true)
  })

  it('hasOnlinePeer(role) returns false when no peer has matching role', () => {
    const awareness = makeAwareness(1)
    const peerState = { role: ROLES.GUEST }
    awareness.getStates = vi.fn().mockReturnValue(new Map([[2, peerState]]))

    const transport = new AdmissionTransport(awareness)

    expect(transport.hasOnlinePeer(ROLES.OWNER)).toBe(false)
  })

  it('unsubscribe function from onMessage() calls awareness.off', () => {
    const awareness = makeAwareness()
    const transport = new AdmissionTransport(awareness)

    const unsub = transport.onMessage(() => {})
    unsub()

    expect(awareness.off).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('destroy() calls all registered unsubscribes', () => {
    const awareness = makeAwareness()
    const transport = new AdmissionTransport(awareness)

    transport.onMessage(() => {})
    transport.onMessage(() => {})

    transport.destroy()

    expect(awareness.off).toHaveBeenCalledTimes(2)
  })

  it('clientId getter returns awareness.clientID', () => {
    const awareness = makeAwareness(42)
    const transport = new AdmissionTransport(awareness)

    expect(transport.clientId).toBe(42)
  })
})
