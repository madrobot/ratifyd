import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import LandingPage from './LandingPage'

beforeEach(() => {
  history.pushState({}, '', '/')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('LandingPage', () => {
  it('renders the heading and description', () => {
    render(<LandingPage />)
    expect(screen.getByText('Ratifyd')).toBeDefined()
    expect(
      screen.getByText('Ephemeral technical interviews. No account required.')
    ).toBeDefined()
  })

  it('renders the "Start Session" button', () => {
    render(<LandingPage />)
    const button = screen.getByRole('button', { name: 'Start Session' })
    expect(button).toBeDefined()
  })

  it('navigates to /room when "Start Session" button is clicked', async () => {
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window.location, 'href', {
      set: assignSpy,
      configurable: true,
    })

    render(<LandingPage />)
    const button = screen.getByRole('button', { name: 'Start Session' })
    button.click()

    expect(assignSpy).toHaveBeenCalledWith('/room')
  })
})
