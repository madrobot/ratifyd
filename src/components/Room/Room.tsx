import { useRoom } from '../../hooks/useRoom'

export default function Room({ token }: { token: string | null }) {
  const { status } = useRoom(token)

  if (status === 'connecting') return <div>Connecting...</div>
  if (status === 'awaiting') return <div>Waiting for owner to join...</div>
  if (status === 'error') return <div>Failed to connect.</div>

  return (
    <div>
      <h1>Room</h1>
      <p>Room connected</p>
    </div>
  )
}
