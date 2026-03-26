import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useInstructions } from './useInstructions'
import type { Room } from '../lib/Room'

function makeRoom(overrides?: Partial<Room>): Room {
  return {
    getInstructions: vi.fn().mockResolvedValue(''),
    updateInstructions: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    ...overrides,
  } as unknown as Room
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useInstructions', () => {
  it('returns empty string when room is null', () => {
    const { result } = renderHook(() => useInstructions(null))
    expect(result.current.instructions).toBe('')
  })

  it('loads initial instructions from room.getInstructions()', async () => {
    const mockRoom = makeRoom({
      getInstructions: vi.fn().mockResolvedValue('Write a function that reverses a string.'),
    })

    const { result } = renderHook(() => useInstructions(mockRoom))

    await waitFor(() => {
      expect(result.current.instructions).toBe('Write a function that reverses a string.')
    })
  })

  it('updates instructions when "instructions" event fires', async () => {
    const mockRoom = makeRoom({
      getInstructions: vi.fn().mockResolvedValue('initial'),
    })

    const { result } = renderHook(() => useInstructions(mockRoom))

    await waitFor(() => {
      expect(result.current.instructions).toBe('initial')
    })

    const onCall = vi.mocked(mockRoom.on).mock.calls.find(([event]) => event === 'instructions')
    expect(onCall).toBeDefined()
    const instructionsHandler = onCall![1] as (text: string) => void

    act(() => {
      instructionsHandler('updated instructions')
    })

    expect(result.current.instructions).toBe('updated instructions')
  })

  it('update() calls room.updateInstructions(text)', async () => {
    const mockRoom = makeRoom()

    const { result } = renderHook(() => useInstructions(mockRoom))

    await act(async () => {
      await result.current.update('new instructions text')
    })

    expect(mockRoom.updateInstructions).toHaveBeenCalledWith('new instructions text')
  })

  it('calls room.off("instructions") on unmount', async () => {
    const mockRoom = makeRoom()

    const { unmount } = renderHook(() => useInstructions(mockRoom))

    await waitFor(() => {
      expect(mockRoom.on).toHaveBeenCalledWith('instructions', expect.any(Function))
    })

    unmount()

    expect(mockRoom.off).toHaveBeenCalledWith('instructions', expect.any(Function))
  })

  it('stays empty and does not throw when getInstructions rejects (guest)', async () => {
    const mockRoom = makeRoom({
      getInstructions: vi.fn().mockRejectedValue(new Error('Guests cannot read instructions')),
    })

    const { result } = renderHook(() => useInstructions(mockRoom))

    // Give async operations a chance to settle
    await waitFor(() => {
      expect(mockRoom.getInstructions).toHaveBeenCalled()
    })

    expect(result.current.instructions).toBe('')
  })
})
