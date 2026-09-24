import { useState } from 'react'
import type { SetupProblem } from '@shared/api'
import { api } from '../api'

export function StartingScreen() {
  return (
    <div className="drag flex h-full flex-col items-center justify-center bg-bg">
      <p className="rise font-app text-[20px] font-semibold tracking-tight text-ink-soft">Opening your mail…</p>
      <p className="rise mt-2 text-[12.5px] text-ink-faint" style={{ animationDelay: '120ms' }}>
        Syncing with HEY through the CLI
      </p>
    </div>
  )
}

const COPY: Record<SetupProblem['code'], { title: string; body: string; command?: string }> = {
  binary: {
    title: 'HEY CLI needed',
    body: 'This app works through the official HEY command-line tool. Install it, then try again.',
    command: 'https://github.com/basecamp/hey-cli',
  },
  auth: {
    title: 'Sign in to the HEY CLI',
    body: 'The CLI is installed but not signed in. Run this in a terminal, finish signing in, then try again.',
    command: 'hey auth login',
  },
  other: {
    title: 'Something went wrong',
    body: 'The app could not reach HEY through the CLI.',
  },
}

export function SetupScreen({ problem }: { problem: SetupProblem }) {
  const [busy, setBusy] = useState(false)
  const copy = COPY[problem.code]
  return (
    <div className="drag flex h-full items-center justify-center bg-bg p-8">
      <div className="no-drag rise w-full max-w-[460px] rounded-ui-lg border border-rule bg-pane p-9">
        <h1 className="font-app text-[24px] leading-tight font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-3 leading-relaxed text-ink-soft">{copy.body}</p>
        {copy.command && (
          <code className="mt-5 block rounded-ui bg-pane-sunk px-4 py-3 font-mono text-[12.5px] select-text">{copy.command}</code>
        )}
        <p className="mt-4 text-[12px] break-words text-ink-faint select-text">{problem.message}</p>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await api.retry().finally(() => setBusy(false))
          }}
          className="mt-7 rounded-ui bg-accent px-4 py-2 text-[13px] font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Try again'}
        </button>
      </div>
    </div>
  )
}
