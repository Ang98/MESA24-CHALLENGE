import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { callEntry, getQueue, noShowEntry, recoverLink, removeEntry, seatEntry } from '../api/tablet'
import type { TabletQueueItem, TabletQueueResponse } from '../api/types'
import { TABLET_POLL_INTERVAL_MS, usePolling } from '../lib/usePolling'
import { clearTabletToken, getTabletToken, setTabletToken } from '../lib/storage'

/** Minutos esperando = server_time - joined_at (nunca el reloj de la tablet). */
// eslint-disable-next-line react-refresh/only-export-components -- funcion pura, exportada para poder testearla aparte.
export function minutesWaiting(serverTime: string, joinedAt: string): number {
  const diffMs = new Date(serverTime).getTime() - new Date(joinedAt).getTime()
  return Math.max(0, Math.floor(diffMs / 60_000))
}

export function TabletPage() {
  const [token, setToken] = useState<string | null>(() => getTabletToken())
  const [queue, setQueue] = useState<TabletQueueResponse | null>(null)
  const [offline, setOffline] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [pendingRowIds, setPendingRowIds] = useState<Set<number>>(() => new Set())
  const [rowNotice, setRowNotice] = useState<string | null>(null)
  const [recoverUrl, setRecoverUrl] = useState<string | null>(null)

  // Se incrementa en cada refresh (polling) y al resolverse cada accion:
  // sirve solo para que el GET mas nuevo gane sobre uno atrasado (refreshFor).
  // Las acciones NO lo usan para decidir si aplican su propio resultado: un
  // tick de polling, un visibilitychange o un "online" podrian incrementarlo
  // mientras el POST de la accion sigue en vuelo, y descartarian esa
  // respuesta sin motivo (bug real: el dialogo de "Recuperar turno" no se
  // abria, o no se mostraban los avisos de 409/404).
  const requestIdRef = useRef(0)
  // Solo cambia al guardar o cambiar el token: es lo que usan las acciones
  // para decidir si su resultado sigue siendo valido.
  const tokenEpochRef = useRef(0)

  function addPendingRow(id: number): void {
    setPendingRowIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  function removePendingRow(id: number): void {
    setPendingRowIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  const goToTokenForm = useCallback((message: string) => {
    clearTabletToken()
    setToken(null)
    setQueue(null)
    setTokenError(message)
  }, [])

  const refreshFor = useCallback(
    async (currentToken: string) => {
      if (!navigator.onLine) {
        setOffline(true)
        return
      }
      const requestId = ++requestIdRef.current
      const epoch = tokenEpochRef.current
      try {
        const data = await getQueue(currentToken)
        if (requestIdRef.current !== requestId || tokenEpochRef.current !== epoch) return
        setQueue(data)
        setOffline(false)
        setLastUpdated(new Date())
      } catch (err) {
        if (requestIdRef.current !== requestId || tokenEpochRef.current !== epoch) return
        if (err instanceof ApiError && err.status === 401) {
          goToTokenForm('El token no es válido o fue revocado')
        } else {
          setOffline(true)
        }
      }
    },
    [goToTokenForm],
  )

  const refresh = useCallback(() => {
    if (!token) return Promise.resolve()
    return refreshFor(token)
  }, [token, refreshFor])

  usePolling(refresh, TABLET_POLL_INTERVAL_MS)

  useEffect(() => {
    function handleOnline(): void {
      void refresh()
    }
    function handleOffline(): void {
      setOffline(true)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refresh])

  function resetQueueState(): void {
    setQueue(null)
    setOffline(false)
    setLastUpdated(null)
    setRowNotice(null)
  }

  function handleSaveToken(newToken: string): void {
    tokenEpochRef.current += 1 // invalida el resultado de cualquier accion en curso con el token anterior
    requestIdRef.current += 1 // invalida cualquier GET en curso con el token anterior
    setTabletToken(newToken)
    setToken(newToken)
    setTokenError(null)
    resetQueueState()
    void refreshFor(newToken) // refresca de inmediato, sin esperar el siguiente tick
  }

  function handleChangeToken(): void {
    tokenEpochRef.current += 1 // invalida el resultado de cualquier accion en curso con el token anterior
    requestIdRef.current += 1 // invalida cualquier GET en curso con el token anterior
    clearTabletToken()
    setToken(null)
    resetQueueState()
  }

  async function runAction(id: number, action: (t: string, entryId: number) => Promise<TabletQueueItem>): Promise<void> {
    if (!token) return
    const epoch = tokenEpochRef.current
    addPendingRow(id)
    setRowNotice(null)
    try {
      await action(token, id)
    } catch (err) {
      if (tokenEpochRef.current === epoch) {
        if (err instanceof ApiError && err.status === 409) {
          setRowNotice('Otra tablet ya cambió este turno')
        } else if (err instanceof ApiError && err.status === 404) {
          setRowNotice('Ese turno ya no existe')
        }
      }
    } finally {
      // La respuesta de la accion siempre gana sobre un GET de polling que
      // estuviera en curso; el refresco de aqui abajo es el mas nuevo. Si se
      // cambio de token mientras tanto, `refresh` todavia usa el anterior: no
      // se refresca (un 401 del token viejo borraria el nuevo).
      if (tokenEpochRef.current === epoch) {
        requestIdRef.current += 1
        await refresh()
      }
      removePendingRow(id)
    }
  }

  async function handleRecoverLink(id: number): Promise<void> {
    if (!token) return
    const epoch = tokenEpochRef.current
    addPendingRow(id)
    setRowNotice(null)
    try {
      const result = await recoverLink(token, id)
      if (tokenEpochRef.current === epoch) {
        setRecoverUrl(result.url)
      }
    } catch (err) {
      if (tokenEpochRef.current === epoch) {
        if (err instanceof ApiError && err.status === 409) {
          setRowNotice('Otra tablet ya cambió este turno')
          await refresh()
        } else if (err instanceof ApiError && err.status === 404) {
          setRowNotice('Ese turno ya no existe')
          await refresh()
        } else if (err instanceof ApiError && err.status === 401) {
          goToTokenForm('El token no es válido o fue revocado')
        } else {
          setRowNotice('No se pudo obtener el enlace. Vuelve a intentarlo.')
          await refresh()
        }
      }
    } finally {
      removePendingRow(id)
    }
  }

  if (!token) {
    return <TokenForm onSave={handleSaveToken} error={tokenError} />
  }

  return (
    <main className="tablet-page">
      <header className="tablet-header">
        <h1>{queue?.location.name ?? 'Cola'}</h1>
        <button type="button" className="ghost" onClick={handleChangeToken}>
          Cambiar token
        </button>
      </header>

      {offline ? <OfflineBanner lastUpdated={lastUpdated} /> : null}
      {rowNotice ? <p className="notice">{rowNotice}</p> : null}

      <QueueList
        queue={queue}
        disabled={offline}
        pendingRowIds={pendingRowIds}
        onCall={(id) => void runAction(id, callEntry)}
        onSeat={(id) => void runAction(id, seatEntry)}
        onNoShow={(id) => void runAction(id, noShowEntry)}
        onRemove={(id) => void runAction(id, removeEntry)}
        onRecoverLink={(id) => void handleRecoverLink(id)}
      />

      {recoverUrl ? <RecoverLinkDialog url={recoverUrl} onClose={() => setRecoverUrl(null)} /> : null}
    </main>
  )
}

function TokenForm({ onSave, error }: { onSave: (token: string) => void; error: string | null }) {
  const [value, setValue] = useState('')

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    const trimmed = value.trim()
    if (trimmed) {
      onSave(trimmed)
    }
  }

  return (
    <main className="token-form">
      <h1>Ingresar a la tablet</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="tablet-token">Token de la tablet</label>
        <input id="tablet-token" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        {error ? <p className="field-error">{error}</p> : null}
        <button type="submit">Entrar</button>
      </form>
    </main>
  )
}

function OfflineBanner({ lastUpdated }: { lastUpdated: Date | null }) {
  const formatted = lastUpdated ? lastUpdated.toLocaleTimeString('es-PE') : '--:--:--'
  return <p className="offline-banner">Sin conexión · última actualización {formatted}</p>
}

interface QueueListProps {
  queue: TabletQueueResponse | null
  disabled: boolean
  pendingRowIds: Set<number>
  onCall: (id: number) => void
  onSeat: (id: number) => void
  onNoShow: (id: number) => void
  onRemove: (id: number) => void
  onRecoverLink: (id: number) => void
}

function QueueList({ queue, disabled, pendingRowIds, onCall, onSeat, onNoShow, onRemove, onRecoverLink }: QueueListProps) {
  if (!queue) {
    return <p>Cargando…</p>
  }
  if (queue.entries.length === 0) {
    return <p>Sin turnos en espera.</p>
  }
  return (
    <ul className="queue-list">
      {queue.entries.map((item) => (
        <QueueRow
          key={item.id}
          item={item}
          serverTime={queue.server_time}
          disabled={disabled}
          pending={pendingRowIds.has(item.id)}
          onCall={() => onCall(item.id)}
          onSeat={() => onSeat(item.id)}
          onNoShow={() => onNoShow(item.id)}
          onRemove={() => onRemove(item.id)}
          onRecoverLink={() => onRecoverLink(item.id)}
        />
      ))}
    </ul>
  )
}

interface QueueRowProps {
  item: TabletQueueItem
  serverTime: string
  disabled: boolean
  pending: boolean
  onCall: () => void
  onSeat: () => void
  onNoShow: () => void
  onRemove: () => void
  onRecoverLink: () => void
}

function QueueRow({ item, serverTime, disabled, pending, onCall, onSeat, onNoShow, onRemove, onRecoverLink }: QueueRowProps) {
  const minutes = minutesWaiting(serverTime, item.joined_at)
  const rowDisabled = disabled || pending

  function handleRemove(): void {
    if (window.confirm('¿Quitar este turno de la cola?')) {
      onRemove()
    }
  }

  return (
    <li className="queue-row">
      <span className="name">{item.name}</span>
      <span className="party">{item.party_size} pers.</span>
      <span className="minutes">{minutes} min</span>
      <span className="phone">···{item.phone_last3}</span>
      <span className="status">{item.status === 'waiting' ? 'En espera' : 'Llamado'}</span>
      {item.on_my_way ? <span className="tag">En camino</span> : null}
      <span className="actions">
        {item.status === 'waiting' ? (
          <>
            <button type="button" onClick={onCall} disabled={rowDisabled}>
              Llamar
            </button>
            <button type="button" onClick={onSeat} disabled={rowDisabled}>
              Sentar
            </button>
            <button type="button" onClick={handleRemove} disabled={rowDisabled}>
              Quitar
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onSeat} disabled={rowDisabled}>
              Sentar
            </button>
            <button type="button" onClick={onNoShow} disabled={rowDisabled}>
              No vino
            </button>
          </>
        )}
        <button type="button" onClick={onRecoverLink} disabled={rowDisabled}>
          Recuperar turno
        </button>
      </span>
    </li>
  )
}

function RecoverLinkDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  async function handleCopy(): Promise<void> {
    try {
      if (!navigator.clipboard) {
        throw new Error('sin clipboard')
      }
      await navigator.clipboard.writeText(url)
      setCopyNotice('Copiado')
    } catch {
      inputRef.current?.select()
      setCopyNotice('Cópialo manualmente')
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog">
        <label htmlFor="recover-url">Enlace del turno</label>
        <input id="recover-url" ref={inputRef} readOnly value={url} onFocus={(e) => e.target.select()} />
        {copyNotice ? <p className="notice">{copyNotice}</p> : null}
        <div className="dialog-actions">
          <button type="button" onClick={() => void handleCopy()}>
            Copiar
          </button>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
