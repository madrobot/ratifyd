import { useState, useEffect } from 'react'
import { decodeJWT } from '../jwt'
import { generateSigningKeyPair } from '../crypto/signing'
import { generateOaepKeyPair } from '../crypto/oaep'
import {
  saveSigningKeyPair,
  saveOaepKeyPair,
  loadSigningPrivateKey,
  loadSigningPublicKeyB64,
  loadPeerId,
  savePeerId,
} from '../crypto/storage'
import { isOwnerSelfAdmit, ownerSelfAdmit } from '../admission'
import { useYjs } from '../yjs/YjsContext'
import { ROLES, type Role } from '../../constants'

export interface SessionState {
  role: Role | null
  peerId: string | null
  roomId: string | null
  ready: boolean
  needsLobby: boolean
  error: string | null
}

const INITIAL_STATE: SessionState = {
  role: null,
  peerId: null,
  roomId: null,
  ready: false,
  needsLobby: false,
  error: null,
}

/**
 * Resolves the current peer's session state.
 *
 * YjsProvider has already gated on indexeddbProvider.on('synced') before
 * this hook runs, so burnedJTIs and trustedSigningKeys are guaranteed to
 * be fully restored from IndexedDB before any admission check runs.
 */
export function useSession(token: string): SessionState {
  const { shared, webrtc } = useYjs()
  const [session, setSession] = useState<SessionState>(INITIAL_STATE)

  useEffect(() => {
    if (!token) {
      setSession((s) => ({ ...s, error: 'NO_TOKEN' }))
      return
    }

    async function init() {
      try {
        const { payload } = decodeJWT(token)
        const localPeerId = loadPeerId()
        const hasOtherPeers = webrtc.awareness.getStates().size > 1

        // --- OWNER SELF-ADMIT ---
        if (isOwnerSelfAdmit(payload, localPeerId, hasOtherPeers)) {
          const sigPubKeyB64 = loadSigningPublicKeyB64(localPeerId!)
          if (!sigPubKeyB64) throw new Error('Owner signing public key not found in localStorage')
          ownerSelfAdmit(payload, sigPubKeyB64, localPeerId!, shared)
          setSession({
            role: ROLES.OWNER,
            peerId: localPeerId,
            roomId: payload.room,
            ready: true,
            needsLobby: false,
            error: null,
          })
          return
        }

        // --- INVITED PEER: ensure keypairs exist ---
        let peerId: string

        if (payload.role === ROLES.MODERATOR) {
          peerId = localPeerId ?? crypto.randomUUID()
          const existingKey = peerId === localPeerId ? await loadSigningPrivateKey(peerId) : null
          if (!existingKey) {
            const sigKP = await generateSigningKeyPair()
            const oaepKP = await generateOaepKeyPair()
            await saveSigningKeyPair(sigKP.privateKey, sigKP.publicKey, peerId)
            await saveOaepKeyPair(oaepKP.privateKey, oaepKP.publicKey, peerId)
            savePeerId(peerId)
          }
        } else {
          // Guest — signing keypair only, no OAEP
          peerId = loadPeerId() ?? crypto.randomUUID()
          const existingKey = await loadSigningPrivateKey(peerId)
          if (!existingKey) {
            const sigKP = await generateSigningKeyPair()
            await saveSigningKeyPair(sigKP.privateKey, sigKP.publicKey, peerId)
            savePeerId(peerId)
          }
        }

        // Check if owner is online to run the handshake
        const ownerOnline = [...webrtc.awareness.getStates().values()].some(
          (s: Record<string, unknown>) => s['role'] === ROLES.OWNER && s['peerId'] !== peerId,
        )

        if (!ownerOnline) {
          setSession({
            role: null,
            peerId,
            roomId: payload.room,
            ready: false,
            needsLobby: true,
            error: null,
          })
          return
        }

        // Handshake is event-driven — set PENDING; WebRTC handlers complete it
        setSession({
          role: null,
          peerId,
          roomId: payload.room,
          ready: false,
          needsLobby: false,
          error: 'PENDING_HANDSHAKE',
        })
      } catch (err) {
        console.error('Session init failed:', err)
        setSession((s) => ({ ...s, error: 'SESSION_INIT_FAILED' }))
      }
    }

    void init()
  }, [token, shared, webrtc])

  return session
}
