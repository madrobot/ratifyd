import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'
import { SIGNALING_SERVERS, YJS_ROOM_PREFIX } from '../../constants'

export interface ProvidersResult {
  webrtcProvider: WebrtcProvider
  indexeddbProvider: IndexeddbPersistence
  indexeddbSynced: Promise<void>
  destroy: () => void
}

/**
 * Initialises y-webrtc and y-indexeddb providers.
 *
 * CRITICAL — indexeddbSynced:
 * The returned promise resolves when IndexedDB has fully restored the Yjs
 * document. Peer admission (owner only) MUST NOT run until this promise
 * resolves. This prevents a race where burnedJTIs or trustedSigningKeys
 * are not yet populated when a peer connects.
 *
 * YjsContext.tsx enforces this by not rendering children until synced.
 */
export function initProviders(ydoc: Y.Doc, roomId: string): ProvidersResult {
  const roomName = `${YJS_ROOM_PREFIX}${roomId}`
  const webrtcProvider = new WebrtcProvider(roomName, ydoc, { signaling: SIGNALING_SERVERS })
  const indexeddbProvider = new IndexeddbPersistence(roomName, ydoc)
  const indexeddbSynced = new Promise<void>((resolve) => indexeddbProvider.on('synced', resolve))

  return {
    webrtcProvider,
    indexeddbProvider,
    indexeddbSynced,
    destroy: () => {
      webrtcProvider.destroy()
      indexeddbProvider.destroy()
    },
  }
}
