export default function LandingPage() {
  const handleStart = () => {
    window.location.href = '/room'
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
      }}
    >
      <h1>Ratifyd</h1>
      <p>Ephemeral technical interviews. No account required.</p>
      <button onClick={handleStart}>Start Session</button>
    </div>
  )
}
