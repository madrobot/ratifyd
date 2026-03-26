import { useState, useEffect } from 'react'
import { Room } from '../lib/Room'
import type { RoomStatus } from '../lib/Room'

export function useRoom(token: string | null): { room: Room | null; status: RoomStatus } {
  const [room, setRoom] = useState<Room | null>(null)
  const [status, setStatus] = useState<RoomStatus>('connecting')

  useEffect(() => {
    if (!token) return
    let r: Room | undefined
    let cancelled = false

    Room.join(token)
      .then((joined) => {
        if (cancelled) {
          joined.destroy()
          return
        }
        r = joined
        setRoom(r)
        setStatus(r.status)
        r.on('status', setStatus as (...args: unknown[]) => void)
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      r?.destroy()
      setRoom(null)
    }
  }, [token])

  return { room, status }
}
