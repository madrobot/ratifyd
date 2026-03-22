import type { ClaimToken } from '../../constants'

export default function Room({ token }: { token: ClaimToken }) {
  return (
    <div>
      <h1>Room</h1>
      <p>Room: {token.payload.room}</p>
      <p>Role: {token.payload.role}</p>
    </div>
  )
}
