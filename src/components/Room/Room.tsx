import type { JWTToken } from '../../constants'

export default function Room({ token }: { token: JWTToken }) {
  return (
    <div>
      <h1>Room</h1>
      <p>Token: {token}</p>
    </div>
  )
}
