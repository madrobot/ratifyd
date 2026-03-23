import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
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
  const [value, setValue] = useState<YjsContextValue | null>(null)

  useEffect(() => {
    const ydoc = createYjsDoc()
    const shared = getSharedTypes(ydoc)
    const { webrtcProvider, indexeddbSynced, destroy } = initProviders(ydoc, roomId)

    indexeddbSynced.then(() => setValue({ ydoc, shared, webrtc: webrtcProvider }))

    return () => {
      destroy()
      ydoc.destroy()
      setValue(null)
    }
  }, [roomId])

  if (!value) return <div>Connecting...</div>

  return <YjsContext.Provider value={value}>{children}</YjsContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useYjs(): YjsContextValue {
  const ctx = useContext(YjsContext)
  if (!ctx) throw new Error('useYjs must be used within YjsProvider')
  return ctx
}
