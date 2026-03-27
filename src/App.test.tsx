import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import App from './App'

vi.mock('./components/LandingPage/LandingPage', () => ({
  default: () => <div data-testid="landing" />,
}))

vi.mock('./components/Room/Room', () => ({
  default: ({ token }: { token: string | null }) => (
    <div data-testid="room" data-token={token ?? ''} />
  ),
}))

beforeEach(() => {
  history.pushState({}, '', '/')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App routing', () => {
  describe('isRoom detection', () => {
    it('renders Room when pathname is /room', () => {
      history.pushState({}, '', '/room')
      render(<App />)
      expect(screen.getByTestId('room')).toBeDefined()
      expect(screen.queryByTestId('landing')).toBeNull()
    })

    it('renders Room when pathname ends with /room (base path variant)', () => {
      history.pushState({}, '', '/ratifyd/room')
      render(<App />)
      expect(screen.getByTestId('room')).toBeDefined()
      expect(screen.queryByTestId('landing')).toBeNull()
    })

    it('renders LandingPage when pathname is /', () => {
      history.pushState({}, '', '/')
      render(<App />)
      expect(screen.getByTestId('landing')).toBeDefined()
      expect(screen.queryByTestId('room')).toBeNull()
    })

    it('renders LandingPage for other non-room paths', () => {
      history.pushState({}, '', '/about')
      render(<App />)
      expect(screen.getByTestId('landing')).toBeDefined()
      expect(screen.queryByTestId('room')).toBeNull()
    })
  })

  describe('token extraction', () => {
    it('passes token from hash fragment to Room', () => {
      history.pushState({}, '', '/room#token=abc123')
      render(<App />)
      expect(screen.getByTestId('room').getAttribute('data-token')).toBe('abc123')
    })

    it('passes null when hash is absent', () => {
      history.pushState({}, '', '/room')
      render(<App />)
      // null renders as empty string via data-token={token ?? ''}
      expect(screen.getByTestId('room').getAttribute('data-token')).toBe('')
    })

    it('passes null when hash is #token= (empty value normalization fix)', () => {
      history.pushState({}, '', '/room#token=')
      render(<App />)
      // normalization: empty string is coerced to null, renders as ''
      expect(screen.getByTestId('room').getAttribute('data-token')).toBe('')
    })
  })

  describe('event listeners', () => {
    it('re-renders on hashchange — switches from landing to room', async () => {
      history.pushState({}, '', '/')
      const { unmount } = render(<App />)
      expect(screen.getByTestId('landing')).toBeDefined()

      await act(async () => {
        history.pushState({}, '', '/room')
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })

      expect(screen.getByTestId('room')).toBeDefined()
      unmount()
    })

    it('re-renders on popstate — switches from room to landing', async () => {
      history.pushState({}, '', '/room')
      const { unmount } = render(<App />)
      expect(screen.getByTestId('room')).toBeDefined()

      await act(async () => {
        history.pushState({}, '', '/')
        window.dispatchEvent(new PopStateEvent('popstate'))
      })

      expect(screen.getByTestId('landing')).toBeDefined()
      unmount()
    })

    it('updates token when hashchange fires with new token', async () => {
      history.pushState({}, '', '/room')
      const { unmount } = render(<App />)
      expect(screen.getByTestId('room').getAttribute('data-token')).toBe('')

      await act(async () => {
        history.pushState({}, '', '/room#token=newtoken')
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })

      expect(screen.getByTestId('room').getAttribute('data-token')).toBe('newtoken')
      unmount()
    })

    it('removes hashchange and popstate listeners on unmount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener')
      const removeSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = render(<App />)

      const hashchangeAdded = addSpy.mock.calls.filter(([event]) => event === 'hashchange')
      const popstateAdded = addSpy.mock.calls.filter(([event]) => event === 'popstate')
      expect(hashchangeAdded).toHaveLength(1)
      expect(popstateAdded).toHaveLength(1)

      unmount()

      const hashchangeRemoved = removeSpy.mock.calls.filter(([event]) => event === 'hashchange')
      const popstateRemoved = removeSpy.mock.calls.filter(([event]) => event === 'popstate')
      expect(hashchangeRemoved).toHaveLength(1)
      expect(popstateRemoved).toHaveLength(1)
    })
  })
})
