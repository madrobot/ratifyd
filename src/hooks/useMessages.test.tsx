import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useMessages } from './useMessages'
import type { Room, DecryptedMessage } from '../domain/Room'

function makeMessage(overrides?: Partial<DecryptedMessage>): DecryptedMessage {
  return {
    id: crypto.randomUUID(),
    peerId: 'peer-1',
    text: 'Hello',
    sentAt: Date.now(),
    ...overrides,
  }
}

function makeRoom(overrides?: Partial<Room>): Room {
  return {
    getMessages: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as unknown as Room
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useMessages', () => {
  it('returns empty messages when room is null', () => {
    const { result } = renderHook(() => useMessages(null))
    expect(result.current.messages).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('populates messages from room.getMessages() on mount', async () => {
    const msgs = [makeMessage({ sentAt: 1000 }), makeMessage({ sentAt: 2000 })]
    const mockRoom = makeRoom({
      getMessages: vi.fn().mockResolvedValue(msgs),
    })

    const { result } = renderHook(() => useMessages(mockRoom))

    await waitFor(() => {
      expect(result.current.messages).toEqual(msgs)
    })
    expect(result.current.loading).toBe(false)
  })

  it('registers "new-message" listener and appends incoming messages', async () => {
    const mockRoom = makeRoom({
      getMessages: vi.fn().mockResolvedValue([]),
    })

    const { result } = renderHook(() => useMessages(mockRoom))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    const onCall = vi.mocked(mockRoom.on).mock.calls.find(([event]) => event === 'new-message')
    expect(onCall).toBeDefined()
    const newMessageHandler = onCall![1] as (msg: DecryptedMessage) => void

    const incoming = makeMessage({ text: 'New message' })
    act(() => {
      newMessageHandler(incoming)
    })

    expect(result.current.messages).toContainEqual(incoming)
  })

  it('calls room.off("new-message") on unmount', async () => {
    const mockRoom = makeRoom()

    const { unmount } = renderHook(() => useMessages(mockRoom))

    await waitFor(() => {
      expect(mockRoom.on).toHaveBeenCalledWith('new-message', expect.any(Function))
    })

    unmount()

    expect(mockRoom.off).toHaveBeenCalledWith('new-message', expect.any(Function))
  })

  it('loadMore() calls getMessages with { before: oldest.sentAt }', async () => {
    const older = makeMessage({ sentAt: 500 })
    const newer = makeMessage({ sentAt: 1500 })
    const evenOlder = makeMessage({ sentAt: 100 })

    const getMessages = vi
      .fn()
      .mockResolvedValueOnce([older, newer]) // initial load
      .mockResolvedValueOnce([evenOlder]) // loadMore call

    const mockRoom = makeRoom({ getMessages })

    const { result } = renderHook(() => useMessages(mockRoom))

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
    })

    await act(async () => {
      await result.current.loadMore()
    })

    expect(getMessages).toHaveBeenCalledWith({ before: older.sentAt })
    expect(result.current.messages[0]).toEqual(evenOlder)
    expect(result.current.messages).toHaveLength(3)
  })

  it('stays empty and does not throw when getMessages rejects (guest)', async () => {
    const mockRoom = makeRoom({
      getMessages: vi.fn().mockRejectedValue(new Error('Guests cannot read messages')),
    })

    const { result } = renderHook(() => useMessages(mockRoom))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.messages).toEqual([])
  })
})
