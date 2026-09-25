import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api, ApiEvent } from '@shared/api'

interface Bridge {
  call(method: string, args: unknown[]): Promise<unknown>
  onEvent(cb: (event: ApiEvent) => void): () => void
}

declare global {
  interface Window {
    bridge?: Bridge
  }
}

// In Electron the preload provides the bridge; in a browser (pnpm dev:web) it is HTTP.
const token = import.meta.env.VITE_API_TOKEN as string | undefined
const httpBridge: Bridge = {
  async call(method, args) {
    const res = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-token': token ?? '' },
      body: JSON.stringify(args),
    })
    const body = (await res.json()) as unknown
    if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText)
    return body
  },
  onEvent(cb) {
    const source = new EventSource(`/api/events?token=${encodeURIComponent(token ?? '')}`)
    source.onmessage = (m) => cb(JSON.parse(m.data as string) as ApiEvent)
    return () => source.close()
  },
}

const bridge = window.bridge ?? httpBridge

export const api = new Proxy({} as Api, {
  get: (_, method: string) => (...args: unknown[]) => bridge.call(method, args),
})

/** URL the renderer can load an attachment from (downloaded through the CLI on first use). */
export const fileUrl = (id: string) =>
  window.bridge
    ? `superhey-file://attachment/${encodeURIComponent(id)}`
    : `/api/file/${encodeURIComponent(id)}?token=${encodeURIComponent(token ?? '')}`

/** URL for a sender's avatar image; answers 404 when HEY only has initials for them. */
export const avatarUrl = (heyUrl: string) =>
  window.bridge
    ? `superhey-file://avatar/${encodeURIComponent(heyUrl)}`
    : `/api/avatar?u=${encodeURIComponent(heyUrl)}&token=${encodeURIComponent(token ?? '')}`

export const onApiEvent = (cb: (event: ApiEvent) => void) => bridge.onEvent(cb)

/**
 * Loads data and reloads it whenever `shouldReload` says a cache change affects it.
 * Keeps showing the previous value while reloading, so the UI never flashes empty.
 */
export function useLive<T>(
  load: () => Promise<T>,
  deps: unknown[],
  shouldReload: (event: ApiEvent) => boolean = () => false,
) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loadRef = useRef(load)
  loadRef.current = load
  const reloadRef = useRef(shouldReload)
  reloadRef.current = shouldReload

  const reload = useCallback(() => {
    let cancelled = false
    setLoading(true)
    loadRef.current().then(
      (d) => {
        if (cancelled) return
        setData(d)
        setError(null)
        setLoading(false)
      },
      (e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = onApiEvent((event) => {
      if (!reloadRef.current(event)) return
      clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [reload])

  return { data, error, loading, reload }
}
