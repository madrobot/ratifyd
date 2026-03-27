import { useState, useEffect } from 'react'
import { parseFragment, type Route } from './router'
import LandingPage from './components/LandingPage/LandingPage'
import Room from './components/Room/Room'

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseFragment())

  useEffect(() => {
    const fn = () => setRoute(parseFragment())
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
  }, [])

  if (route.route === 'room') return <Room token={route.token} />
  return <LandingPage />
}
