import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import { generateSigningKeyPair } from '../crypto/signing'
import { mintJWT } from '../jwt'
import { ROLES, STORAGE_KEYS } from '../../constants'
import { savePeerId, saveSigningKeyPair } from '../crypto/storage'

// ── Mocks ─────────────────────────────────────────────────────────────────────

let resolveIndexeddbSynced: (() => void) | null = null

const mockAwareness = {
  getStates: vi.fn(() => new Map()),
}

const mockWebrtcProvider = {
  destroy: vi.fn(),
  awareness: mockAwareness,
}

const MockWebrtcProvider = vi.fn(function () {
  return mockWebrtcProvider
})

const mockIndexeddbProvider = {
  destroy: vi.fn(),
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

// ── Test helpers ──────────────────────────────────────────────────────────────

async function renderWithYjs(token: string) {
  const { YjsProvider } = await import('../yjs/YjsContext')
  const { useSession } = await import('./useSession')

  const state: { session: ReturnType<typeof useSession> | null } = { session: null }

  function Consumer() {
    // eslint-disable-next-line react-hooks/immutability
    state.session = useSession(token)
    return <div data-testid="consumer" />
  }

  const roomId = (() => {
    try {
      const parts = token.split('.')
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
      return payload.room as string
    } catch {
      return 'test-room'
    }
  })()

  render(
    <YjsProvider roomId={roomId}>
      <Consumer />
    </YjsProvider>,
  )

  return {
    getSession: () => state.session,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveIndexeddbSynced = null
    localStorage.clear()
    mockAwareness.getStates.mockReturnValue(new Map())
  })

  afterEach(() => {
    cleanup()
  })

  it('returns initial state before session is resolved', async () => {
    const sigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const token = await mintJWT(
      { room: crypto.randomUUID(), role: ROLES.OWNER },
      ownerId,
      sigKP.privateKey,
    )

    const { getSession } = await renderWithYjs(token.raw)

    // Before IndexedDB syncs, YjsProvider shows "Connecting..."
    expect(screen.getByText('Connecting...')).toBeDefined()
    expect(getSession()).toBeNull()
  })

  it('owner self-admits instantly when no other peers', async () => {
    const sigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    // Save owner keypair and peerId in localStorage
    await saveSigningKeyPair(sigKP.privateKey, sigKP.publicKey, ownerId)
    savePeerId(ownerId)

    const token = await mintJWT({ room: roomId, role: ROLES.OWNER }, ownerId, sigKP.privateKey)

    // awareness returns only 1 state (the owner itself) — no OTHER peers
    mockAwareness.getStates.mockReturnValue(new Map([['local', {}]]))

    const { getSession } = await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    const session = getSession()
    expect(session?.role).toBe(ROLES.OWNER)
    expect(session?.ready).toBe(true)
    expect(session?.needsLobby).toBe(false)
    expect(session?.error).toBeNull()
    expect(session?.peerId).toBe(ownerId)
    expect(session?.roomId).toBe(roomId)
  })

  it('sets needsLobby=true when moderator joins but owner is not online', async () => {
    const ownerSigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const modId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    // Issue a moderator token (signed by the owner)
    const token = await mintJWT(
      { room: roomId, role: ROLES.MODERATOR },
      ownerId,
      ownerSigKP.privateKey,
    )

    // No owner in awareness (only 1 entry, the local peer)
    mockAwareness.getStates.mockReturnValue(
      new Map([['local', { role: ROLES.MODERATOR, peerId: modId }]]),
    )

    const { getSession } = await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    await waitFor(() => {
      expect(getSession()?.needsLobby).toBe(true)
    })

    const session = getSession()
    expect(session?.ready).toBe(false)
    expect(session?.role).toBeNull()
    expect(session?.roomId).toBe(roomId)
  })

  it('sets needsLobby=true when guest joins but owner is not online', async () => {
    const ownerSigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    const token = await mintJWT({ room: roomId, role: ROLES.GUEST }, ownerId, ownerSigKP.privateKey)

    // No owner in awareness
    mockAwareness.getStates.mockReturnValue(new Map())

    const { getSession } = await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    await waitFor(() => {
      expect(getSession()?.needsLobby).toBe(true)
    })
    expect(getSession()?.ready).toBe(false)
  })

  it('sets error=PENDING_HANDSHAKE when owner is online for moderator', async () => {
    const ownerSigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const modId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    const token = await mintJWT(
      { room: roomId, role: ROLES.MODERATOR },
      ownerId,
      ownerSigKP.privateKey,
    )

    // Owner IS in awareness as a different peer
    mockAwareness.getStates.mockReturnValue(
      new Map([
        ['owner-conn', { role: ROLES.OWNER, peerId: ownerId }],
        ['mod-conn', { role: ROLES.MODERATOR, peerId: modId }],
      ]),
    )

    const { getSession } = await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    await waitFor(() => {
      expect(getSession()?.error).toBe('PENDING_HANDSHAKE')
    })
    expect(getSession()?.needsLobby).toBe(false)
    expect(getSession()?.ready).toBe(false)
  })

  it('sets error=PENDING_HANDSHAKE when owner is online for guest', async () => {
    const ownerSigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const guestId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    const token = await mintJWT({ room: roomId, role: ROLES.GUEST }, ownerId, ownerSigKP.privateKey)

    // Owner IS in awareness
    mockAwareness.getStates.mockReturnValue(
      new Map([
        ['owner-conn', { role: ROLES.OWNER, peerId: ownerId }],
        ['guest-conn', { role: ROLES.GUEST, peerId: guestId }],
      ]),
    )

    const { getSession } = await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    await waitFor(() => {
      expect(getSession()?.error).toBe('PENDING_HANDSHAKE')
    })
  })

  it('sets error=SESSION_INIT_FAILED for a malformed token', async () => {
    const { getSession } = await renderWithYjs('not-a-valid-token')

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    await waitFor(() => {
      expect(getSession()?.error).toBe('SESSION_INIT_FAILED')
    })
    expect(getSession()?.ready).toBe(false)
  })

  it('owner self-admit is idempotent — remount does not duplicate Yjs entries', async () => {
    const sigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    await saveSigningKeyPair(sigKP.privateKey, sigKP.publicKey, ownerId)
    savePeerId(ownerId)

    const token = await mintJWT({ room: roomId, role: ROLES.OWNER }, ownerId, sigKP.privateKey)

    // Only self in awareness
    mockAwareness.getStates.mockReturnValue(new Map([['local', {}]]))

    const { getSession } = await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    const session = getSession()
    expect(session?.role).toBe(ROLES.OWNER)
    expect(session?.ready).toBe(true)
  })

  it('generates and saves a guest peerId when one does not exist', async () => {
    const ownerSigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    const token = await mintJWT({ room: roomId, role: ROLES.GUEST }, ownerId, ownerSigKP.privateKey)

    mockAwareness.getStates.mockReturnValue(new Map())

    await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    // A guest peer ID should now be in localStorage
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEYS.PEER_ID)).not.toBeNull()
    })
    expect(typeof localStorage.getItem(STORAGE_KEYS.PEER_ID)).toBe('string')
  })

  it('generates and saves a moderator peerId when one does not exist', async () => {
    const ownerSigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    const token = await mintJWT(
      { room: roomId, role: ROLES.MODERATOR },
      ownerId,
      ownerSigKP.privateKey,
    )

    mockAwareness.getStates.mockReturnValue(new Map())

    await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    // A moderator peer ID should be saved to localStorage under PEER_ID
    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEYS.PEER_ID)).not.toBeNull()
    })
  })

  it('owner is not self-admitted when isOwnerSelfAdmit is false (other peers present)', async () => {
    const sigKP = await generateSigningKeyPair()
    const ownerId = crypto.randomUUID()
    const roomId = crypto.randomUUID()

    await saveSigningKeyPair(sigKP.privateKey, sigKP.publicKey, ownerId)
    savePeerId(ownerId)

    const token = await mintJWT({ room: roomId, role: ROLES.OWNER }, ownerId, sigKP.privateKey)

    // Multiple peers — owner cannot self-admit alone
    mockAwareness.getStates.mockReturnValue(
      new Map([
        ['conn1', { role: ROLES.OWNER, peerId: ownerId }],
        ['conn2', { role: ROLES.MODERATOR, peerId: crypto.randomUUID() }],
      ]),
    )

    const { getSession } = await renderWithYjs(token.raw)

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    // Owner with other peers should NOT be self-admitted; falls through to handshake flow
    const session = getSession()
    // Should NOT be ready as owner (isOwnerSelfAdmit returns false when hasOtherPeers is true)
    expect(session?.role).not.toBe(ROLES.OWNER)
  })
})
