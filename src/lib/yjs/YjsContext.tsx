import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WebrtcProvider } from 'y-webrtc'
import { createYjsDoc, getSharedTypes, type SharedTypes } from './doc'
import { initProviders } from './providers'
import type * as Y from 'yjs'

interface YjsContextValue {
  ydoc: Y.Doc
  shared: SharedTypes
  webrtc: WebrtcProvider
}

const YjsContext = createContext<YjsContextValue | null>(null)

interface YjsProviderProps {
  roomId: string
  children: ReactNode
}

/**
 * Does NOT render children until IndexedDB syncs.
 * This is the admission gate — owner's burnedJTIs and trustedSigningKeys
 * must be fully restored before any peer connection is evaluated.
 */
export function YjsProvider({ roomId, children }: YjsProviderProps) {
  const [ready, setReady] = useState(false)
  const valueRef = useRef<YjsContextValue | null>(null)

  useEffect(() => {
    const ydoc = createYjsDoc()
    const shared = getSharedTypes(ydoc)
    const { webrtcProvider, indexeddbSynced, destroy } = initProviders(ydoc, roomId)

    valueRef.current = { ydoc, shared, webrtc: webrtcProvider }
    indexeddbSynced.then(() => setReady(true))

    return () => {
      destroy()
      ydoc.destroy()
    }
  }, [roomId])

  if (!ready || !valueRef.current) return <div>Connecting...</div>

  return <YjsContext.Provider value={valueRef.current}>{children}</YjsContext.Provider>
}

export function useYjs(): YjsContextValue {
  const ctx = useContext(YjsContext)
  if (!ctx) throw new Error('useYjs must be used within YjsProvider')
  return ctx
}
