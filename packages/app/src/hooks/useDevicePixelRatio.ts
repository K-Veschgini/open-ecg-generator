import { useEffect, useState } from 'react'

function currentDpr(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
}

/**
 * The current window.devicePixelRatio, updated when it changes (moving the
 * window between monitors of different density, or browser zoom). A
 * `(resolution: Xdppx)` media query only fires when the ratio leaves X, so it
 * is re-armed for the new value after every change. A window resize listener
 * is a fallback for browsers that change the ratio together with the
 * viewport (zoom) without firing the media query.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(currentDpr)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    // Pick up a change that happened between the first render and this effect.
    if (currentDpr() !== dpr) {
      setDpr(currentDpr())
      return
    }
    const mql = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = () => setDpr(currentDpr())
    mql.addEventListener('change', onChange)
    window.addEventListener('resize', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
      window.removeEventListener('resize', onChange)
    }
  }, [dpr])

  return dpr
}
