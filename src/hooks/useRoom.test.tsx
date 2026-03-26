import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRoom } from './useRoom'
import { Room } from '../lib/Room'

vi.mock('../lib/Room', () => ({
  Room: {
    join: vi.fn(),
  },
}))

function makeRoom(overrides?: Partial<Room>): Room {
  return {
    status: 'connected',
    on: vi.fn(),
    off: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  } as unknown as Room
}

const mockedJoin = vi.mocked(Room.join)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useRoom', () => {
  it('returns null room and "connecting" status when token is null', () => {
    const { result } = renderHook(() => useRoom(null))
    expect(result.current.room).toBeNull()
    expect(result.current.status).toBe('connecting')
  })

  it('sets room and status after Room.join resolves', async () => {
    const mockRoom = makeRoom({ status: 'connected' })
    mockedJoin.mockResolvedValue(mockRoom)

    const { result } = renderHook(() => useRoom('test-token'))

    await waitFor(() => {
      expect(result.current.room).toBe(mockRoom)
    })

    expect(result.current.status).toBe('connected')
    expect(mockRoom.on).toHaveBeenCalledWith('status', expect.any(Function))
  })

  it('sets status to "error" when Room.join rejects', async () => {
    mockedJoin.mockRejectedValue(new Error('join failed'))

    const { result } = renderHook(() => useRoom('bad-token'))

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })

    expect(result.current.room).toBeNull()
  })

  it('calls room.destroy() on unmount', async () => {
    const mockRoom = makeRoom()
    mockedJoin.mockResolvedValue(mockRoom)

    const { result, unmount } = renderHook(() => useRoom('test-token'))

    await waitFor(() => {
      expect(result.current.room).toBe(mockRoom)
    })

    unmount()

    expect(mockRoom.destroy).toHaveBeenCalled()
  })

  it('updates status when "status" event fires', async () => {
    const mockRoom = makeRoom({ status: 'connected' })
    mockedJoin.mockResolvedValue(mockRoom)

    const { result } = renderHook(() => useRoom('test-token'))

    await waitFor(() => {
      expect(result.current.room).toBe(mockRoom)
    })

    // Capture the handler registered with on('status', ...)
    const onCall = vi.mocked(mockRoom.on).mock.calls.find(([event]) => event === 'status')
    expect(onCall).toBeDefined()
    const statusHandler = onCall![1] as (status: unknown) => void

    act(() => {
      statusHandler('awaiting')
    })

    expect(result.current.status).toBe('awaiting')
  })

  it('destroys the room immediately if the hook is unmounted before join resolves', async () => {
    let resolveJoin!: (r: Room) => void
    mockedJoin.mockImplementation(
      () =>
        new Promise<Room>((res) => {
          resolveJoin = res
        }),
    )

    const { unmount } = renderHook(() => useRoom('test-token'))
    unmount()

    const mockRoom = makeRoom()
    act(() => {
      resolveJoin(mockRoom)
    })

    // Room resolved after unmount — must be destroyed immediately
    await waitFor(() => {
      expect(mockRoom.destroy).toHaveBeenCalled()
    })
  })
})
