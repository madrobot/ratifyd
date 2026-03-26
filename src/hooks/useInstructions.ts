import { useState, useEffect, useCallback } from 'react'
import type { Room } from '../lib/Room'

export function useInstructions(room: Room | null) {
  const [instructions, setInstructions] = useState('')

  useEffect(() => {
    if (!room) return

    // Initial load
    room
      .getInstructions()
      .then(setInstructions)
      .catch(() => {
        /* guest or no key — instructions stay empty */
      })

    // Real-time updates
    // Capture the cast to a stable reference — same object for on() and off()
    const handler = setInstructions as (...args: unknown[]) => void
    room.on('instructions', handler)
    return () => room.off('instructions', handler)
  }, [room])

  const update = useCallback(
    (text: string) => room?.updateInstructions(text) ?? Promise.resolve(),
    [room],
  )

  return { instructions, update }
}
