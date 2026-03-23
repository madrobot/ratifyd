import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { YJS_ROOM_PREFIX, SIGNALING_SERVERS } from '../../constants'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockWebrtcDestroy = vi.fn()
const mockWebrtcProvider = {
  destroy: mockWebrtcDestroy,
}
// Must use `function` keyword so vitest treats it as a constructor
const MockWebrtcProvider = vi.fn(function () {
  return mockWebrtcProvider
})

const mockIndexeddbDestroy = vi.fn()
let resolveIndexeddbSynced: (() => void) | null = null
const mockIndexeddbProvider = {
  destroy: mockIndexeddbDestroy,
  on: vi.fn(function (event: string, cb: () => void) {
    if (event === 'synced') resolveIndexeddbSynced = cb
  }),
}
const MockIndexeddbPersistence = vi.fn(function () {
  return mockIndexeddbProvider
})

vi.mock('y-webrtc', () => ({
  WebrtcProvider: MockWebrtcProvider,
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: MockIndexeddbPersistence,
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('initProviders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveIndexeddbSynced = null
  })

  it('constructs WebrtcProvider with the correct room name and signaling servers', async () => {
    const { initProviders } = await import('./providers')
    const ydoc = new Y.Doc()
    const roomId = 'test-room-123'

    initProviders(ydoc, roomId)

    expect(MockWebrtcProvider).toHaveBeenCalledWith(`${YJS_ROOM_PREFIX}${roomId}`, ydoc, {
      signaling: SIGNALING_SERVERS,
    })
    ydoc.destroy()
  })

  it('constructs IndexeddbPersistence with the correct room name', async () => {
    const { initProviders } = await import('./providers')
    const ydoc = new Y.Doc()
    const roomId = 'room-abc'

    initProviders(ydoc, roomId)

    expect(MockIndexeddbPersistence).toHaveBeenCalledWith(`${YJS_ROOM_PREFIX}${roomId}`, ydoc)
    ydoc.destroy()
  })

  it('returns webrtcProvider and indexeddbProvider', async () => {
    const { initProviders } = await import('./providers')
    const ydoc = new Y.Doc()

    const result = initProviders(ydoc, 'room-1')

    expect(result.webrtcProvider).toBe(mockWebrtcProvider)
    expect(result.indexeddbProvider).toBe(mockIndexeddbProvider)
    ydoc.destroy()
  })

  it('registers a synced listener on the indexeddb provider', async () => {
    const { initProviders } = await import('./providers')
    const ydoc = new Y.Doc()

    initProviders(ydoc, 'room-2')

    expect(mockIndexeddbProvider.on).toHaveBeenCalledWith('synced', expect.any(Function))
    ydoc.destroy()
  })

  it('indexeddbSynced promise resolves when synced event fires', async () => {
    const { initProviders } = await import('./providers')
    const ydoc = new Y.Doc()

    const { indexeddbSynced } = initProviders(ydoc, 'room-3')

    let resolved = false
    indexeddbSynced.then(() => {
      resolved = true
    })

    expect(resolved).toBe(false)
    resolveIndexeddbSynced?.()

    await indexeddbSynced
    expect(resolved).toBe(true)
    ydoc.destroy()
  })

  it('destroy() calls destroy on both providers', async () => {
    const { initProviders } = await import('./providers')
    const ydoc = new Y.Doc()

    const { destroy } = initProviders(ydoc, 'room-4')
    destroy()

    expect(mockWebrtcDestroy).toHaveBeenCalledOnce()
    expect(mockIndexeddbDestroy).toHaveBeenCalledOnce()
    ydoc.destroy()
  })

  it('uses room prefix from constants (not hardcoded)', async () => {
    const { initProviders } = await import('./providers')
    const ydoc = new Y.Doc()
    const roomId = 'unique-room-id'

    initProviders(ydoc, roomId)

    const expectedName = `${YJS_ROOM_PREFIX}${roomId}`
    expect(MockWebrtcProvider).toHaveBeenCalledWith(expectedName, ydoc, expect.anything())
    expect(MockIndexeddbPersistence).toHaveBeenCalledWith(expectedName, ydoc)
    ydoc.destroy()
  })
})
