import type { ClaimToken } from '../../constants'

export default function Room({ token }: { token: ClaimToken }) {
  return (
    <div>
      <h1>Room</h1>
      <p>Token: {token}</p>
    </div>
  )
}
