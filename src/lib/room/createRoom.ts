import { generateSigningKeyPair } from '../crypto/signing'
import { generateOaepKeyPair } from '../crypto/oaep'
import { generateRoomKey } from '../crypto/roomKey'
import { saveSigningKeyPair, saveOaepKeyPair, saveRoomKey, savePeerId } from '../crypto/storage'
import { mintJWT } from '../jwt'
import { navigateToRoom } from '../router'
import { ROLES, JWT_EXPIRY_SECONDS } from '../../constants'

/**
 * Room creation flow — triggered by "Start Session" button.
 *
 * Generates:
 *   1. RSA signing keypair  → localStorage (JWT signing + nonce proof)
 *   2. RSA-OAEP keypair     → localStorage (for receiving room key)
 *   3. AES-GCM room key     → localStorage (encrypts notes + chat in Yjs)
 *   4. ownerId (UUID)       → localStorage
 *   5. roomId (UUID)
 *   6. Self-issued owner JWT → URL fragment
 *
 * Public keys are NEVER placed in the URL.
 * Self-admission runs in useSession after YjsProvider is ready.
 */
export async function createRoom(): Promise<void> {
  const ownerId = crypto.randomUUID()
  const roomId = crypto.randomUUID()

  const signingKP = await generateSigningKeyPair()
  const oaepKP = await generateOaepKeyPair()
  const roomKey = await generateRoomKey()

  await saveSigningKeyPair(signingKP.privateKey, signingKP.publicKey, ownerId)
  await saveOaepKeyPair(oaepKP.privateKey, oaepKP.publicKey, ownerId)
  await saveRoomKey(roomKey, roomId)
  savePeerId(ownerId)

  const token = await mintJWT(
    { room: roomId, role: ROLES.OWNER },
    ownerId,
    signingKP.privateKey,
    JWT_EXPIRY_SECONDS,
  )

  navigateToRoom(token)
}
