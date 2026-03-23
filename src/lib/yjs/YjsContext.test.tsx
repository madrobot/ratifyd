import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import * as Y from 'yjs'

// ── Mocks ────────────────────────────────────────────────────────────────────

let resolveIndexeddbSynced: (() => void) | null = null

const mockWebrtcProvider = { destroy: vi.fn() }
// Must use `function` keyword so vitest treats it as a constructor
const MockWebrtcProvider = vi.fn(function () { return mockWebrtcProvider })

const mockIndexeddbProvider = {
  destroy: vi.fn(),
  on: vi.fn(function (event: string, cb: () => void) {
    if (event === 'synced') resolveIndexeddbSynced = cb
  }),
}
const MockIndexeddbPersistence = vi.fn(function () { return mockIndexeddbProvider })

vi.mock('y-webrtc', () => ({
  WebrtcProvider: MockWebrtcProvider,
}))

vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: MockIndexeddbPersistence,
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('YjsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveIndexeddbSynced = null
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a loading state before IndexedDB syncs', async () => {
    const { YjsProvider } = await import('./YjsContext')

    render(
      <YjsProvider roomId="test-room">
        <div data-testid="child">Child content</div>
      </YjsProvider>,
    )

    expect(screen.getByText('Connecting...')).toBeDefined()
    expect(screen.queryByTestId('child')).toBeNull()
  })

  it('renders children after IndexedDB syncs', async () => {
    const { YjsProvider } = await import('./YjsContext')

    render(
      <YjsProvider roomId="test-room">
        <div data-testid="child">Child content</div>
      </YjsProvider>,
    )

    // Trigger the synced event
    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    expect(screen.getByTestId('child')).toBeDefined()
    expect(screen.queryByText('Connecting...')).toBeNull()
  })

  it('does not render children before IndexedDB syncs', async () => {
    const { YjsProvider } = await import('./YjsContext')

    render(
      <YjsProvider roomId="test-room">
        <div data-testid="child">Child content</div>
      </YjsProvider>,
    )

    // No sync triggered yet
    expect(screen.queryByTestId('child')).toBeNull()
  })

  it('calls initProviders with the given roomId', async () => {
    const { YjsProvider } = await import('./YjsContext')

    render(
      <YjsProvider roomId="my-special-room">
        <div />
      </YjsProvider>,
    )

    expect(MockWebrtcProvider).toHaveBeenCalledWith(
      expect.stringContaining('my-special-room'),
      expect.any(Y.Doc),
      expect.anything(),
    )
  })

  it('destroys providers on unmount', async () => {
    const { YjsProvider } = await import('./YjsContext')

    const { unmount } = render(
      <YjsProvider roomId="cleanup-room">
        <div />
      </YjsProvider>,
    )

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    unmount()

    expect(mockWebrtcProvider.destroy).toHaveBeenCalledOnce()
    expect(mockIndexeddbProvider.destroy).toHaveBeenCalledOnce()
  })
})

describe('useYjs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveIndexeddbSynced = null
  })

  afterEach(() => {
    cleanup()
  })

  it('provides ydoc, shared, and webrtc after sync', async () => {
    const { YjsProvider, useYjs } = await import('./YjsContext')
    let capturedCtx: ReturnType<typeof useYjs> | null = null

    function Consumer() {
      capturedCtx = useYjs()
      return <div data-testid="consumer" />
    }

    render(
      <YjsProvider roomId="ctx-room">
        <Consumer />
      </YjsProvider>,
    )

    await act(async () => {
      resolveIndexeddbSynced?.()
    })

    expect(capturedCtx).not.toBeNull()
    expect(capturedCtx!.ydoc).toBeInstanceOf(Y.Doc)
    expect(capturedCtx!.shared).toHaveProperty('editorContent')
    expect(capturedCtx!.webrtc).toBe(mockWebrtcProvider)
  })

  it('throws when used outside YjsProvider', async () => {
    const { useYjs } = await import('./YjsContext')

    function BareConsumer() {
      useYjs()
      return <div />
    }

    expect(() => render(<BareConsumer />)).toThrow('useYjs must be used within YjsProvider')
  })
})
