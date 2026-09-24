import { useEffect, useState } from 'react'
import type { AppStatus } from '@shared/api'
import { api, onApiEvent } from './api'

/** Live app status: fetched once, then pushed by the backend. */
export function useAppStatus(): AppStatus | null {
  const [status, setStatus] = useState<AppStatus | null>(null)
  useEffect(() => {
    let alive = true
    void api.status().then((s) => alive && setStatus(s))
    const off = onApiEvent((e) => {
      if (e.type === 'status') setStatus(e.status)
    })
    return () => {
      alive = false
      off()
    }
  }, [])
  return status
}
