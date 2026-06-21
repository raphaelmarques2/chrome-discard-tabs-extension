import { createSignal, onMount, For } from 'solid-js'
import type { UrlRule } from '../shared/types'

function isValidMinutes(value: number): boolean {
  return Number.isFinite(value) && value >= 1
}

function isQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /quota/i.test(message)
}

function storageErrorMessage(err: unknown): string {
  if (isQuotaError(err)) {
    return 'Limite de armazenamento atingido. Remova regras antigas.'
  }
  return 'Erro ao carregar configurações. Tente novamente.'
}

function saveErrorMessage(err: unknown): string {
  if (isQuotaError(err)) {
    return 'Limite de armazenamento atingido. Remova regras antigas.'
  }
  return 'Erro ao salvar configurações. Tente novamente.'
}

export default function App() {
  const [rules, setRules] = createSignal<UrlRule[]>([])
  const [pattern, setPattern] = createSignal('')
  const [minutes, setMinutes] = createSignal(30)
  const [error, setError] = createSignal('')

  onMount(async () => {
    try {
      const result = await chrome.storage.sync.get('rules')
      setRules((result['rules'] as UrlRule[]) ?? [])
    } catch (err) {
      setError(storageErrorMessage(err))
    }
  })

  async function addRule() {
    if (!pattern().trim()) {
      setError('Informe um padrão de URL')
      return
    }
    if (!isValidMinutes(minutes())) {
      setError('Tempo mínimo é 1 minuto')
      return
    }
    setError('')
    const newRule: UrlRule = {
      id: crypto.randomUUID(),
      pattern: pattern().trim(),
      timeoutMs: minutes() * 60 * 1000,
    }
    const updated = [...rules(), newRule]
    const previous = rules()
    setRules(updated)
    try {
      await chrome.storage.sync.set({ rules: updated })
      setPattern('')
    } catch (err) {
      setRules(previous)
      setError(saveErrorMessage(err))
    }
  }

  async function removeRule(id: string) {
    const updated = rules().filter((r) => r.id !== id)
    const previous = rules()
    setRules(updated)
    try {
      await chrome.storage.sync.set({ rules: updated })
    } catch (err) {
      setRules(previous)
      setError(saveErrorMessage(err))
    }
  }

  return (
    <div style={{ padding: '16px', 'min-width': '340px', 'font-family': 'system-ui' }}>
      <h2 style={{ margin: '0 0 16px' }}>Tab Suspender</h2>

      <div style={{ display: 'flex', gap: '8px', 'margin-bottom': '8px' }}>
        <input
          type="text"
          placeholder="*://github.com/*"
          value={pattern()}
          onInput={(e) => setPattern(e.currentTarget.value)}
          style={{ flex: '1', padding: '6px' }}
        />
        <input
          type="number"
          min="1"
          value={minutes()}
          onInput={(e) => {
            const raw = e.currentTarget.value
            setMinutes(raw === '' ? NaN : Number(raw))
          }}
          style={{ width: '64px', padding: '6px' }}
        />
        <span style={{ 'align-self': 'center' }}>min</span>
        <button onClick={addRule} style={{ padding: '6px 12px' }}>
          Adicionar
        </button>
      </div>

      {error() && (
        <p style={{ color: 'red', margin: '4px 0 8px', 'font-size': '13px' }}>{error()}</p>
      )}

      <ul style={{ 'list-style': 'none', padding: '0', margin: '0' }}>
        <For each={rules()}>
          {(rule) => (
            <li
              style={{
                display: 'flex',
                'justify-content': 'space-between',
                'align-items': 'center',
                padding: '8px 0',
                'border-bottom': '1px solid #eee',
                gap: '8px',
              }}
            >
              <code style={{ 'font-size': '13px', flex: '1' }}>{rule.pattern}</code>
              <span style={{ 'font-size': '13px', 'white-space': 'nowrap' }}>
                {rule.timeoutMs / 60000} min
              </span>
              <button
                onClick={() => removeRule(rule.id)}
                style={{ padding: '2px 8px', cursor: 'pointer' }}
                aria-label="Remover regra"
              >
                ✕
              </button>
            </li>
          )}
        </For>
      </ul>

      {rules().length === 0 && (
        <p
          style={{
            color: '#888',
            'font-size': '13px',
            'text-align': 'center',
            'margin-top': '16px',
          }}
        >
          Nenhuma regra configurada
        </p>
      )}
    </div>
  )
}
