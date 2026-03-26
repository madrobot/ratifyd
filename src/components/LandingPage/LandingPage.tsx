import { useState } from 'react'
import { Room } from '../../lib/Room'

export default function LandingPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStart = async () => {
    setLoading(true)
    setError(null)
    try {
      const room = await Room.create()
      const params = new URLSearchParams()
      params.set('token', room.token)
      window.location.hash = params.toString()
      room.destroy()
    } catch (err) {
      console.error(err)
      setError('Failed to create session. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
      }}
    >
      <h1>Ratifyd</h1>
      <p>Ephemeral technical interviews. No account required.</p>
      <button onClick={handleStart} disabled={loading}>
        {loading ? 'Creating session...' : 'Start Session'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
