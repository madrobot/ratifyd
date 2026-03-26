import { useRef, useEffect, useCallback } from 'react'
import type { Room } from '../lib/Room'

// Minimal Excalidraw types (avoid importing the full package in hooks)
interface ExcalidrawAPI {
  updateScene(opts: { elements: unknown[] }): void
}

// No dedicated tests for this hook: the Excalidraw API requires a live canvas
// environment that is impractical to mock in happy-dom. The hook logic is
// intentionally minimal — it delegates all behaviour to Room.bindExcalidraw.

export function useExcalidraw(room: Room | null) {
  const apiRef = useRef<ExcalidrawAPI | null>(null)
  const bindingRef = useRef<ReturnType<Room['bindExcalidraw']> | null>(null)

  useEffect(() => {
    if (!room || !apiRef.current) return
    bindingRef.current = room.bindExcalidraw(apiRef.current)
    return () => {
      bindingRef.current?.destroy()
      bindingRef.current = null
    }
  }, [room])

  const onChange = useCallback((elements: unknown[]) => {
    bindingRef.current?.onChange(elements as unknown as readonly never[])
  }, []) // bindingRef is a ref (stable), so empty deps is correct

  return {
    excalidrawRef: apiRef,
    onChange,
  }
}
