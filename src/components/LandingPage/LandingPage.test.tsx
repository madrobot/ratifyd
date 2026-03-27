import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import LandingPage from './LandingPage'

beforeEach(() => {
  history.pushState({}, '', '/')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('LandingPage', () => {
  it('renders the heading and description', () => {
    render(<LandingPage />)
    expect(screen.getByText('Ratifyd')).toBeInTheDocument()
    expect(
      screen.getByText('Ephemeral technical interviews. No account required.'),
    ).toBeInTheDocument()
  })

  it('renders the "Start Session" button', () => {
    render(<LandingPage />)
    const button = screen.getByRole('button', { name: 'Start Session' })
    expect(button).toBeInTheDocument()
  })

  it('navigates to /room when "Start Session" button is clicked', () => {
    const assignSpy = vi.fn()
    vi.stubGlobal('location', {
      set href(v: string) {
        assignSpy(v)
      },
    })

    render(<LandingPage />)
    const button = screen.getByRole('button', { name: 'Start Session' })
    fireEvent.click(button)

    expect(assignSpy).toHaveBeenCalledWith('/' + 'room')
  })
})
