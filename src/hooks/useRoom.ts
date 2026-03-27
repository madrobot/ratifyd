import { useState, useEffect } from 'react'
import { Room } from '../domain/Room'
import type { RoomStatus } from '../domain/Room'

export function useRoom(token: string | null): { room: Room | null; status: RoomStatus } {
  const [room, setRoom] = useState<Room | null>(null)
  const [status, setStatus] = useState<RoomStatus>('connecting')

  useEffect(() => {
    let r: Room | undefined
    let cancelled = false
    const statusHandler = (s: unknown) => setStatus(s as RoomStatus)

    const promise = token === null ? Room.create() : Room.join(token)

    promise
      .then((resolved) => {
        if (cancelled) {
          resolved.destroy()
          return
        }
        r = resolved
        setRoom(r)
        setStatus(r.status)
        r.on('status', statusHandler)
        if (token === null) {
          history.replaceState(
            null,
            '',
            window.location.pathname + '#' + new URLSearchParams({ token: r.token }),
          )
        }
      })
      .catch((err) => {
        console.error('[useRoom] room setup failed:', err)
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      r?.off('status', statusHandler)
      r?.destroy()
      setRoom(null)
    }
  }, [token])

  return { room, status }
}
