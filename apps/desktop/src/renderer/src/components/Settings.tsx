import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AiSettings, AiStatus, AiTask, AiTestResult, ProviderId } from '@shared/api'
import { api, useLive } from '../api'
import { Menu, MenuItem, MenuSeparator } from './Menu'

/**
 * Settings, over the app (⌘, or the command bar). For now: AI. Changes apply as they're
 * made, like macOS settings; an API key is saved only when you press Save.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const status = useLive(() => api.aiStatus(), [], (e) => e.type === 'ai')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const s = status.data
  const save = (change: (settings: AiSettings) => AiSettings) => {
    if (!s) return
    setError(null)
    api.setAiSettings(change(s.settings)).catch((e: unknown) => setError(message(e)))
  }

  return (
    <div className="fixed inset-0 z-[72] flex items-start justify-center bg-ink/25 px-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Settings" className="settings rise flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-ui-lg border border-rule-strong bg-pane">
        <header className="flex items-baseline gap-3 border-b border-rule px-7 pt-5 pb-4">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Settings</h2>
          <span className="text-[13px] text-ink-faint">AI</span>
          <button onClick={onClose} className="ml-auto rounded-ui px-2 py-0.5 text-[12px] text-ink-faint hover:bg-pane-sunk hover:text-ink" title="Close (Esc)">
            Done
          </button>
        </header>

        <div className="scroll min-h-0 flex-1 px-7 pb-8">
          {status.error && <p className="mt-6 text-danger">Couldn't load the settings: {status.error}</p>}
          {!s ? (
            !status.error && <p className="mt-6 text-ink-faint">Loading…</p>
          ) : (
            <>
              <ModeLine status={s} />
              {error && <p className="mt-3 rounded-ui bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}

              <Section title="AI providers" hint="Your own API keys; each company bills you for what it uses. Automatic tasks use the first provider that’s on.">
                <Providers status={s} save={save} />
              </Section>

              <Section title="Local model" hint="Free and private: runs on this Mac with Ollama or LM Studio. Good for quick tasks; weaker at drafting.">
                <LocalSetup status={s} save={save} />
              </Section>

              <Section title="What runs where" hint="Quick tasks can run locally; the rest go to the cloud. Change any of them.">
                <Tasks status={s} save={save} />
              </Section>

              <Section title="Budget and usage" hint="A hard stop on cloud spending (Claude and OpenAI together) each month. Local models are free and don't count.">
                <Budget status={s} save={save} />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type Provider = AiStatus['providers'][number]

function ModeLine({ status }: { status: AiStatus }) {
  const local = status.settings.local.model
  const { cloud, local: hasLocal } = status.mode
  const cloudName = cloud ? status.providers.find((p) => p.id === cloud)?.name : null
  const text =
    cloudName && hasLocal
      ? `Quick tasks run on ${local}, on this Mac; the rest on ${cloudName}.`
      : cloudName
        ? `Everything runs on ${cloudName}.`
        : hasLocal
          ? `Everything runs on ${local}, on this Mac.`
          : 'AI is off until you add a provider or choose a local model.'
  return (
    <p className="mt-5 flex items-center gap-2 text-[13px] text-ink-soft">
      <StatusMark on={!!(cloud || hasLocal)} />
      {text}
    </p>
  )
}

/** A green check when on (connected, or AI set up); a grey ring when off. */
function StatusMark({ on }: { on: boolean }) {
  return on ? <Check label="On" /> : <span role="img" aria-label="Off" className="inline-block size-[13px] shrink-0 rounded-full border-[1.5px] border-rule-strong" />
}

function Check({ label }: { label?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="inline-block shrink-0 align-[-2px] text-ok">
      <path d="m2.75 8.5 3.5 3.5 7-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mt-7 border-t border-rule pt-5 first-of-type:mt-6">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <p className="mt-0.5 mb-3.5 text-[13px] leading-snug text-ink-faint">{hint}</p>
      {children}
    </section>
  )
}

/**
 * The connected providers, in the order automatic tasks try them, and a way to add one.
 * Adding a provider the app doesn't know yet is a registry entry in the core; nothing here
 * names a provider.
 */
function Providers({ status, save }: { status: AiStatus; save: (change: (s: AiSettings) => AiSettings) => void }) {
  const connected = status.providers.filter((p) => p.hint)
  const available = status.providers.filter((p) => !p.hint)
  const [adding, setAdding] = useState<ProviderId | 'pick' | null>(null)
  const names = modelNames(status)

  // Swap a provider with its neighbour among the connected ones (the order also holds the rest).
  const move = (id: ProviderId, by: -1 | 1) => {
    const i = connected.findIndex((p) => p.id === id)
    const other = connected[i + by]
    if (!other) return
    save((s) => {
      const order = [...s.order]
      const a = order.indexOf(id)
      const b = order.indexOf(other.id)
      ;[order[a], order[b]] = [order[b]!, order[a]!]
      return { ...s, order }
    })
  }

  return (
    <div className="space-y-3">
      {connected.length > 0 ? (
        <ul className="divide-y divide-rule rounded-ui-lg border border-rule" aria-label="Connected providers">
          {connected.map((p, i) => (
            <ProviderRow
              key={p.id}
              provider={p}
              status={status}
              names={names}
              first={i === 0}
              last={i === connected.length - 1}
              onMove={(by) => move(p.id, by)}
              save={save}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-ui-lg border border-dashed border-rule-strong px-4 py-3 text-[13px] text-ink-faint">No provider yet. Add one with its API key; you can add more later.</p>
      )}

      {adding && adding !== 'pick' ? (
        <div className="rounded-ui-lg border border-rule px-4 py-3.5">
          <div className="mb-2.5 text-[13px] font-semibold">Add {status.providers.find((p) => p.id === adding)!.name}</div>
          <KeyForm provider={status.providers.find((p) => p.id === adding)!} canStoreKey={status.canStoreKey} onDone={() => setAdding(null)} />
        </div>
      ) : adding === 'pick' ? (
        <div className="rounded-ui-lg border border-rule p-1.5" role="group" aria-label="Choose a provider">
          {available.map((p) => (
            <button key={p.id} onClick={() => setAdding(p.id)} className="flex w-full items-baseline gap-3 rounded-ui px-3 py-2 text-left hover:bg-pane-alt">
              <span className="w-16 shrink-0 text-[13px] font-semibold text-ink">{p.name}</span>
              <span className="text-[13px] text-ink-faint">{p.blurb}</span>
            </button>
          ))}
          <button onClick={() => setAdding(null)} className="mt-1 w-full rounded-ui px-3 py-1.5 text-left text-[13px] text-ink-faint hover:bg-pane-alt hover:text-ink">
            Cancel
          </button>
        </div>
      ) : (
        available.length > 0 && (
          <button onClick={() => setAdding('pick')} className="btn">
            + Add provider
          </button>
        )
      )}
    </div>
  )
}

function ProviderRow({
  provider: p,
  status,
  names,
  first,
  last,
  onMove,
  save,
}: {
  provider: Provider
  status: AiStatus
  names: Map<string, string>
  first: boolean
  last: boolean
  onMove: (by: -1 | 1) => void
  save: (change: (s: AiSettings) => AiSettings) => void
}) {
  const [panel, setPanel] = useState<'models' | 'key' | null>(null)
  const [test, setTest] = useState<AiTestResult | 'running' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const models = status.models.filter((m) => m.provider === p.id)
  const setProvider = (patch: Partial<NonNullable<AiSettings['providers'][ProviderId]>>) =>
    save((s) => ({ ...s, providers: { ...s.providers, [p.id]: { enabled: true, models: {}, ...s.providers[p.id], ...patch } } }))

  const runTest = async () => {
    setTest('running')
    try {
      setTest(await api.testAi(p.id))
    } catch (e) {
      setTest({ ok: false, code: 'failed', message: message(e) })
    }
  }
  const remove = async () => {
    setError(null)
    try {
      await api.setApiKey(p.id, null)
    } catch (e) {
      setError(message(e))
    }
  }

  return (
    <li className="px-4 py-3" aria-label={p.name}>
      <div className="flex items-center gap-3">
        <StatusMark on={p.enabled} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`text-[14px] font-semibold ${p.enabled ? 'text-ink' : 'text-ink-faint'}`}>{p.name}</span>
            <span className="font-mono text-[12px] text-ink-faint" aria-label={`Stored ${p.name} key`}>
              {p.hint}
            </span>
            {!p.enabled && <span className="text-[12px] text-ink-faint">off</span>}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-faint">
            {names.get(p.models.cheap)} for quick tasks · {names.get(p.models.quality)} for the rest
          </div>
        </div>
        {!(first && last) && (
          <span className="flex">
            <button onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${p.name} up`} title="Try earlier" className="rounded-ui px-1.5 py-1 text-ink-faint hover:bg-pane-sunk hover:text-ink disabled:opacity-30">
              ↑
            </button>
            <button onClick={() => onMove(1)} disabled={last} aria-label={`Move ${p.name} down`} title="Try later" className="rounded-ui px-1.5 py-1 text-ink-faint hover:bg-pane-sunk hover:text-ink disabled:opacity-30">
              ↓
            </button>
          </span>
        )}
        <button onClick={() => void runTest()} disabled={test === 'running' || !p.enabled} className="btn">
          {test === 'running' ? 'Testing…' : 'Test'}
        </button>
        <Menu label={`${p.name} options`} icon={<span aria-hidden className="text-[15px] leading-none">⋯</span>}>
          {(close) => (
            <>
              <MenuItem onSelect={() => (close(), setPanel('models'))}>Change models…</MenuItem>
              <MenuItem onSelect={() => (close(), setPanel('key'))}>Replace key…</MenuItem>
              <MenuItem onSelect={() => (close(), setProvider({ enabled: !p.enabled }))}>{p.enabled ? 'Turn off' : 'Turn on'}</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => (close(), void remove())}>
                Remove
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      {test && test !== 'running' && (
        // Under the name: the row's own mark already says it works.
        <p className={`mt-2 pl-[25px] text-[13px] ${test.ok ? 'text-ink-soft' : 'text-danger'}`}>
          {test.ok ? (
            <>
              {names.get(test.model) ?? test.model} answered in {(test.ms / 1000).toFixed(1)} s · {money(test.costUsd)}
            </>
          ) : (
            test.message
          )}
        </p>
      )}
      {error && <p className="mt-2 pl-[25px] text-[13px] text-danger">{error}</p>}

      {panel === 'models' && (
        <div className="mt-3 flex pl-[25px] flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-soft">
          {(['cheap', 'quality'] as const).map((tier) => (
            <label key={tier} className="flex items-center gap-2">
              {tier === 'cheap' ? 'Quick tasks' : 'The rest'}
              <select
                value={p.models[tier]}
                onChange={(e) => setProvider({ models: { ...status.settings.providers[p.id]?.models, [tier]: e.target.value } })}
                aria-label={`${p.name}: model for ${tier === 'cheap' ? 'quick tasks' : 'the rest'}`}
                className="field py-1 text-[13px]"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {names.get(m.id)} · ${m.price.input}/${m.price.output}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button onClick={() => setPanel(null)} className="ml-auto text-ink-faint hover:text-ink">
            Done
          </button>
        </div>
      )}
      {panel === 'key' && (
        <div className="mt-3 pl-[25px]">
          <KeyForm provider={p} canStoreKey={status.canStoreKey} onDone={() => setPanel(null)} />
        </div>
      )}
    </li>
  )
}

/** A provider's API key: pasted, checked by the main process, stored in the keychain. */
function KeyForm({ provider: p, canStoreKey, onDone }: { provider: Provider; canStoreKey: boolean; onDone: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const store = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.setApiKey(p.id, value)
      setValue('')
      onDone()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) void store()
      }}
      className="space-y-2"
    >
      <div className="flex gap-2">
        <input
          ref={input}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={p.keyPlaceholder}
          aria-label={`${p.name} API key`}
          autoComplete="off"
          spellCheck={false}
          disabled={!canStoreKey || busy}
          className="field min-w-0 flex-1 font-mono text-[13px]"
        />
        <button type="submit" disabled={!value.trim() || busy || !canStoreKey} className="btn-primary">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="btn">
          Cancel
        </button>
      </div>
      {error && <p className="text-[13px] text-danger">{error}</p>}
      <p className="text-[12px] leading-snug text-ink-faint">
        {canStoreKey ? (
          <>
            Create one at{' '}
            <a href={p.keyUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {new URL(p.keyUrl).host}
            </a>
            . It's kept encrypted in your Mac's keychain and only ever sent to {p.company}.
          </>
        ) : (
          'This Mac’s keychain isn’t available here, so a key can’t be stored safely.'
        )}
      </p>
    </form>
  )
}

const PRESETS = [
  { name: 'Ollama', url: 'http://localhost:11434/v1' },
  { name: 'LM Studio', url: 'http://localhost:1234/v1' },
]

function LocalSetup({ status, save }: { status: AiStatus; save: (change: (s: AiSettings) => AiSettings) => void }) {
  const local = status.settings.local
  const [url, setUrl] = useState(local.baseUrl)
  const [models, setModels] = useState<string[] | null>(null)
  const [finding, setFinding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setUrl(local.baseUrl), [local.baseUrl])

  const find = async (baseUrl = local.baseUrl) => {
    setFinding(true)
    setError(null)
    try {
      setModels(await api.localModels(baseUrl))
    } catch (e) {
      setModels(null)
      setError(message(e))
    } finally {
      setFinding(false)
    }
  }
  // Once it's on, see what the server offers.
  useEffect(() => {
    if (local.enabled) void find(local.baseUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local.enabled, local.baseUrl])

  const setBaseUrl = (baseUrl: string) => {
    const trimmed = baseUrl.trim()
    if (trimmed && trimmed !== local.baseUrl) save((s) => ({ ...s, local: { ...s.local, baseUrl: trimmed } }))
  }

  return (
    <div className="space-y-3">
      <Switch label="Use a local model" checked={local.enabled} onChange={(enabled) => save((s) => ({ ...s, local: { ...s.local, enabled } }))} />
      {local.enabled && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={() => setBaseUrl(url)}
              onKeyDown={(e) => e.key === 'Enter' && setBaseUrl(url)}
              aria-label="Local server address"
              spellCheck={false}
              className="field min-w-[260px] flex-1 font-mono text-[13px]"
            />
            {PRESETS.map((p) => (
              <button key={p.name} onClick={() => (setUrl(p.url), setBaseUrl(p.url))} className={`btn ${local.baseUrl === p.url ? 'text-ink' : ''}`} aria-pressed={local.baseUrl === p.url}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={local.model}
              onChange={(e) => save((s) => ({ ...s, local: { ...s.local, model: e.target.value } }))}
              aria-label="Local model"
              disabled={!models?.length}
              className="field min-w-[220px]"
            >
              <option value="">{finding ? 'Looking for models…' : models?.length ? 'Choose a model' : 'No models found'}</option>
              {/* Keep the chosen one listed even when the server is off. */}
              {[...new Set([...(local.model ? [local.model] : []), ...(models ?? [])])].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button onClick={() => void find()} disabled={finding} className="btn">
              {finding ? 'Looking…' : 'Refresh'}
            </button>
          </div>
          {error && <p className="text-[13px] text-danger">{error}</p>}
          {models && models.length === 0 && !error && <p className="text-[13px] text-ink-faint">The server is running but has no models. With Ollama, try `ollama pull llama3.2`.</p>}
          {local.model && <ConnectionTest engine="local" />}
        </>
      )}
    </div>
  )
}

function ConnectionTest({ engine, disabled }: { engine: ProviderId | 'local'; disabled?: boolean }) {
  const [result, setResult] = useState<AiTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await api.testAi(engine))
    } catch (e) {
      setResult({ ok: false, code: 'failed', message: message(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      <button onClick={() => void run()} disabled={busy || disabled} className="btn">
        {busy ? 'Testing…' : 'Test connection'}
      </button>
      {result?.ok && (
        <span className="text-ink-soft">
          <Check /> {result.model} answered in {(result.ms / 1000).toFixed(1)} s{result.engine !== 'local' ? ` · ${money(result.costUsd)}` : ''}
        </span>
      )}
      {result && !result.ok && <span className="text-danger">{result.message}</span>}
    </div>
  )
}

function Tasks({ status, save }: { status: AiStatus; save: (change: (s: AiSettings) => AiSettings) => void }) {
  const names = modelNames(status)
  const set = (id: AiTask, patch: Partial<NonNullable<AiSettings['tasks'][AiTask]>>) =>
    save((s) => ({ ...s, tasks: { ...s.tasks, [id]: { enabled: true, engine: 'auto', ...s.tasks[id], ...patch } } }))

  return (
    <>
      <table className="w-full text-[13px]">
        <thead className="sr-only">
          <tr>
            <th>Task</th>
            <th>Engine and model</th>
            <th>On</th>
          </tr>
        </thead>
        <tbody>
          {status.tasks.map((t) => {
            const own = status.settings.tasks[t.id]
            const enabled = own?.enabled ?? true
            const engine = own?.engine ?? 'auto'
            // Models are offered for the cloud this task runs on (automatic: the preferred one).
            const cloud = engine === 'auto' ? status.mode.cloud : engine === 'local' ? null : engine
            const models = status.models.filter((m) => m.provider === cloud)
            const model = models.some((m) => m.id === own?.model) ? own!.model! : ''
            return (
              <tr key={t.id} className="border-t border-rule first:border-t-0">
                <td className="py-2.5 pr-3">
                  <div className={enabled ? 'text-ink' : 'text-ink-faint'}>{t.label}</div>
                  <div className="text-[12px] text-ink-faint">{runsOn(t.runsOn, names)}</div>
                </td>
                <td className="py-2.5 pr-2 text-right whitespace-nowrap">
                  <select value={engine} onChange={(e) => set(t.id, { engine: e.target.value as 'auto' | ProviderId | 'local' })} aria-label={`${t.label}: engine`} disabled={!enabled} className="field py-1 text-[13px]">
                    <option value="auto">Automatic</option>
                    {/* Connected providers, and whichever this task is pinned to even if it isn't. */}
                    {status.providers
                      .filter((p) => p.hint || p.id === engine)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    <option value="local">Local model</option>
                  </select>{' '}
                  {models.length > 0 && (
                    <select value={model} onChange={(e) => set(t.id, { model: e.target.value || undefined })} aria-label={`${t.label}: model`} disabled={!enabled} className="field py-1 text-[13px]">
                      <option value="">{`${names.get(status.providers.find((p) => p.id === cloud)?.models[t.tier] ?? '') ?? ''} (default)`}</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {names.get(m.id)} · ${m.price.input}/${m.price.output}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="w-10 py-2.5 text-right">
                  <Switch label={`${t.label}: on`} hideLabel checked={enabled} onChange={(on) => set(t.id, { enabled: on })} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

/** Short model names: "Haiku 4.5", "GPT-6 Luna". */
function modelNames(status: AiStatus): Map<string, string> {
  return new Map(status.models.map((m) => [m.id, m.name.replace(/^Claude /, '')]))
}

/** "Haiku 4.5", "llama3.2, on this Mac", or why it can't run. */
function runsOn(r: AiStatus['tasks'][number]['runsOn'], names: Map<string, string>): string {
  if (r.engine === null) return r.reason
  return r.engine === 'local' ? `${r.model}, on this Mac` : (names.get(r.model) ?? r.model)
}

const TASK_NAMES: Record<string, string> = { 'test-claude': 'Connection test', 'test-openai': 'Connection test', 'test-local': 'Connection test' }

function Budget({ status, save }: { status: AiStatus; save: (change: (s: AiSettings) => AiSettings) => void }) {
  const { month } = status
  const budget = status.settings.monthlyBudgetUsd
  const [draft, setDraft] = useState(budget == null ? '' : String(budget))
  useEffect(() => setDraft(budget == null ? '' : String(budget)), [budget])
  const labels = new Map<string, string>(status.tasks.map((t) => [t.id, t.label]))
  const names = modelNames(status)
  const monthName = new Date(month.since).toLocaleString(undefined, { month: 'long' })
  const share = budget ? Math.min(1, month.spentUsd / budget) : 0

  const commit = () => {
    const n = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== budget) save((s) => ({ ...s, monthlyBudgetUsd: Math.round(n * 100) / 100 }))
    else setDraft(budget == null ? '' : String(budget))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <label className="flex items-center gap-2">
          <span className="text-ink-soft">Monthly budget</span>
          <span className="relative">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint">$</span>
            <input
              value={budget == null ? '' : draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              inputMode="decimal"
              disabled={budget == null}
              aria-label="Monthly budget in dollars"
              className="field w-24 pl-5"
            />
          </span>
        </label>
        <Switch label="No limit" checked={budget == null} onChange={(none) => save((s) => ({ ...s, monthlyBudgetUsd: none ? null : 5 }))} />
      </div>

      <div>
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-ink">
            <span className="font-semibold">{money(month.spentUsd)}</span>
            <span className="text-ink-soft">{budget != null ? ` of ${money(budget)}` : ''} in {monthName}</span>
          </span>
          <span className="text-[12px] text-ink-faint">
            {month.calls} {month.calls === 1 ? 'call' : 'calls'}
          </span>
        </div>
        {budget != null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-pane-sunk" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={month.spentUsd} aria-label="Spent this month">
            <div className={`h-full rounded-full ${share >= 1 ? 'bg-danger' : share >= 0.8 ? 'bg-new' : 'bg-accent'}`} style={{ width: `${Math.max(share * 100, month.spentUsd > 0 ? 1.5 : 0)}%` }} />
          </div>
        )}
        {share >= 1 && <p className="mt-2 text-[13px] text-danger">The budget is used up: cloud calls are stopped until next month, or until you raise it.</p>}
      </div>

      {month.byTask.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-faint">
              <th className="pb-1.5 font-medium">Task</th>
              <th className="pb-1.5 font-medium">Model</th>
              <th className="pb-1.5 text-right font-medium">Calls</th>
              <th className="pb-1.5 text-right font-medium">Tokens in / out</th>
              <th className="pb-1.5 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {month.byTask.map((r) => (
              <tr key={`${r.task}-${r.engine}-${r.model}`} className="border-t border-rule">
                <td className="py-1.5 pr-3 text-ink">{labels.get(r.task) ?? TASK_NAMES[r.task] ?? r.task}</td>
                <td className="py-1.5 pr-3 text-ink-soft">{r.engine === 'local' ? `${r.model} (local)` : (names.get(r.model) ?? r.model)}</td>
                <td className="py-1.5 text-right text-ink-soft">{r.calls}</td>
                <td className="py-1.5 text-right text-ink-soft">
                  {tokens(r.input)} / {tokens(r.output)}
                </td>
                <td className="py-1.5 text-right text-ink">{r.engine === 'local' ? 'free' : money(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Switch({ label, checked, onChange, hideLabel }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hideLabel?: boolean }) {
  return (
    <label className="inline-flex cursor-default items-center gap-2 text-[13px] text-ink-soft select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        onClick={() => onChange(!checked)}
        className={`switch relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-rule-strong'}`}
      >
        <span className={`absolute top-[2px] left-[2px] size-[14px] rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[12px]' : ''}`} />
      </button>
      {!hideLabel && label}
    </label>
  )
}

/** "$0.42"; small amounts keep enough digits to be seen ("$0.0031"). */
export function money(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.0001) return '<$0.0001'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

/** "812", "12.3k", "1.2M". */
export function tokens(n: number): string {
  return n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`
}

function message(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method 'api': (Error: )?/, '')
}
