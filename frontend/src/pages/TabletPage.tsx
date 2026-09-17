import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { callEntry, getQueue, noShowEntry, recoverLink, removeEntry, seatEntry } from '../api/tablet'
import type { TabletQueueItem, TabletQueueResponse } from '../api/types'
import { TABLET_POLL_INTERVAL_MS, usePolling } from '../lib/usePolling'
import { clearTabletToken, getTabletToken, setTabletToken } from '../lib/storage'

// Referencia estable para el caso "todavia no hay cola": evita que
// `queue?.entries ?? []` cree un arreglo nuevo (y por lo tanto una dependencia
// de efecto distinta) en cada render mientras `queue` sigue siendo null.
const NO_ENTRIES: TabletQueueItem[] = []

/** Minutos esperando = server_time - joined_at (nunca el reloj de la tablet). */
// eslint-disable-next-line react-refresh/only-export-components -- funcion pura, exportada para poder testearla aparte.
export function minutesWaiting(serverTime: string, joinedAt: string): number {
  const diffMs = new Date(serverTime).getTime() - new Date(joinedAt).getTime()
  return Math.max(0, Math.floor(diffMs / 60_000))
}

/**
 * Hook de presentacion local: retiene brevemente (250ms) las filas que
 * desaparecen de `entries` para poder animar su salida, en vez de que
 * desaparezcan de golpe. No toca `queue` ni ningun estado de negocio.
 *
 * Si el navegador no soporta `matchMedia` (jsdom, en los tests) o el usuario
 * pidio "reducir movimiento", no se retiene nada: la salida es inmediata,
 * igual que antes de este cambio (asi `queryByText(...)` justo despues de
 * quitar/sentar un turno sigue funcionando en los tests sin tocarlos).
 */
function useLeavingRows(entries: TabletQueueItem[]): TabletQueueItem[] {
  const prevEntriesRef = useRef<TabletQueueItem[]>(entries)
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const [leaving, setLeaving] = useState<TabletQueueItem[]>([])

  useEffect(() => {
    const prevEntries = prevEntriesRef.current
    prevEntriesRef.current = entries
    const currentIds = new Set(entries.map((e) => e.id))
    const removed = prevEntries.filter((e) => !currentIds.has(e.id))

    // Si un id que estaba "saliendo" reaparecio (poco probable), se saca de la
    // lista de salida. Si no cambia nada, se devuelve la misma referencia:
    // `entries` puede llegar como un arreglo nuevo en cada render (p. ej.
    // `queue?.entries ?? []` mientras `queue` es null) y sin este chequeo el
    // efecto dispararia un setState -> render -> efecto sin fin.
    setLeaving((prev) => {
      const next = prev.filter((row) => !currentIds.has(row.id))
      return next.length === prev.length ? prev : next
    })

    if (removed.length === 0) return

    const canAnimate = window.matchMedia?.('(prefers-reduced-motion: no-preference)')?.matches === true
    if (!canAnimate) return

    setLeaving((prev) => [...prev.filter((row) => !removed.some((r) => r.id === row.id)), ...removed])

    for (const row of removed) {
      const existingTimer = timersRef.current.get(row.id)
      if (existingTimer) clearTimeout(existingTimer)
      const timer = setTimeout(() => {
        setLeaving((prev) => prev.filter((r) => r.id !== row.id))
        timersRef.current.delete(row.id)
      }, 250)
      timersRef.current.set(row.id, timer)
    }
  }, [entries])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  return leaving
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

  // Presentacion: dia de la semana y conteos de la cola, derivados de datos que ya hay.
  const weekday = new Date().toLocaleDateString('es-PE', { weekday: 'long' })
  const waitingCount = queue?.entries.filter((e) => e.status === 'waiting').length ?? 0
  const calledCount = queue?.entries.filter((e) => e.status === 'called').length ?? 0

  return (
    <div className="tablet-shell">
      <main className="tablet-frame tablet-page">
        <header className="tablet-header">
          <h1>
            {queue?.location.name ?? 'Cola'} <span className="tablet-heading-day">· {weekday}</span>
          </h1>
          <div className="tablet-header-right">
            <p className="tablet-counts">
              {waitingCount} en cola · {calledCount} llamados
            </p>
            <button type="button" className="link-ghost" onClick={handleChangeToken}>
              Cambiar token
            </button>
          </div>
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
    </div>
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
    <div className="token-form-shell">
      <main className="token-form-card token-form">
        <h1>Ingresar a la tablet</h1>
        <form onSubmit={handleSubmit}>
          <label htmlFor="tablet-token" className="field-label">
            Token de la tablet
          </label>
          <input
            id="tablet-token"
            className="input-text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
          {error ? <p className="field-error">{error}</p> : null}
          <button type="submit" className="btn btn-primary">
            Entrar
          </button>
        </form>
      </main>
    </div>
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
  // Los hooks no pueden ser condicionales: se llama siempre, con un arreglo
  // vacio mientras no haya cola cargada todavia.
  const leavingRows = useLeavingRows(queue?.entries ?? NO_ENTRIES)

  if (!queue) {
    return <p className="empty-state">Cargando…</p>
  }
  if (queue.entries.length === 0) {
    return <p className="empty-state">Sin turnos en espera.</p>
  }
  return (
    <ul className="queue-list">
      <li className="queue-row-head" aria-hidden="true">
        <span className="row-pos">#</span>
        <span className="name">Nombre</span>
        <span className="party">Personas</span>
        <span className="minutes">Espera</span>
        <span className="tags">Estado</span>
        <span className="phone">Teléfono</span>
        <span className="actions">Acciones</span>
      </li>
      {queue.entries.map((item, index) => (
        <QueueRow
          key={item.id}
          item={item}
          position={index + 1}
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
      {leavingRows.map((row) => (
        <li key={`leaving-${row.id}`} className="queue-row leaving" role="presentation" aria-hidden="true">
          <span className="name">{row.name}</span>
        </li>
      ))}
    </ul>
  )
}

interface QueueRowProps {
  item: TabletQueueItem
  position: number
  serverTime: string
  disabled: boolean
  pending: boolean
  onCall: () => void
  onSeat: () => void
  onNoShow: () => void
  onRemove: () => void
  onRecoverLink: () => void
}

function QueueRow({
  item,
  position,
  serverTime,
  disabled,
  pending,
  onCall,
  onSeat,
  onNoShow,
  onRemove,
  onRecoverLink,
}: QueueRowProps) {
  const minutes = minutesWaiting(serverTime, item.joined_at)
  const rowDisabled = disabled || pending
  const isCalled = item.status === 'called'

  function handleRemove(): void {
    if (window.confirm('¿Quitar este turno de la cola?')) {
      onRemove()
    }
  }

  return (
    <li className={`queue-row${isCalled ? ' called' : ''}${pending ? ' pending' : ''}`}>
      <span className="row-pos" aria-hidden="true">
        {position}
      </span>
      <span className="name">{item.name}</span>
      <span className="party">{item.party_size} pers.</span>
      <span className="minutes">{minutes} min</span>
      <span className="tags">
        <span className={`status-tag${isCalled ? ' status-tag--called' : ''}`}>
          {item.status === 'waiting' ? 'En espera' : 'Llamado'}
        </span>
        {item.on_my_way ? <span className="tag status-tag status-tag--onway">En camino</span> : null}
      </span>
      <span className="phone">···{item.phone_last3}</span>
      <span className="actions">
        {item.status === 'waiting' ? (
          <>
            <button type="button" className="btn-mini btn-mini-primary" onClick={onCall} disabled={rowDisabled}>
              Llamar
            </button>
            <button type="button" className="btn-mini btn-mini-ghost" onClick={onSeat} disabled={rowDisabled}>
              Sentar
            </button>
            <button type="button" className="btn-mini btn-mini-danger" onClick={handleRemove} disabled={rowDisabled}>
              Quitar
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-mini btn-mini-primary" onClick={onSeat} disabled={rowDisabled}>
              Sentar
            </button>
            <button type="button" className="btn-mini btn-mini-ghost" onClick={onNoShow} disabled={rowDisabled}>
              No vino
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-mini btn-mini-ghost btn-mini-quiet"
          onClick={onRecoverLink}
          disabled={rowDisabled}
        >
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
          <button type="button" className="btn btn-primary" onClick={() => void handleCopy()}>
            Copiar
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
