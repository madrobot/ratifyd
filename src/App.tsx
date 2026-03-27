import { useState, useEffect } from 'react'
import LandingPage from './components/LandingPage/LandingPage'
import Room from './components/Room/Room'

interface RouteSnapshot {
  isRoom: boolean
  token: string | null
}

function getRouteSnapshot(): RouteSnapshot {
  return {
    isRoom: window.location.pathname.endsWith('/room'),
    token: new URLSearchParams(window.location.hash.slice(1)).get('token'),
  }
}

export default function App() {
  const [route, setRoute] = useState<RouteSnapshot>(getRouteSnapshot)

  useEffect(() => {
    const fn = () => setRoute(getRouteSnapshot())
    window.addEventListener('hashchange', fn)
    window.addEventListener('popstate', fn)
    return () => {
      window.removeEventListener('hashchange', fn)
      window.removeEventListener('popstate', fn)
    }
  }, [])

  if (route.isRoom)
    // @ts-expect-error -- Task 4 will fix Room props
    return <Room token={route.token} />
  return <LandingPage />
}
