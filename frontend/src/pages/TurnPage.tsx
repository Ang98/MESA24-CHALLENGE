import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { cancelEntry, getEntry, onMyWay } from '../api/public'
import type { EntryPublic, EntryStatus } from '../api/types'
import { TURN_POLL_INTERVAL_MS, usePolling } from '../lib/usePolling'
import { clearTurnToken, clearTurnTokenIfMatches, getTurnToken, setTurnToken } from '../lib/storage'
import { waitText } from '../lib/waitText'

const FINAL_MESSAGES: Record<string, string> = {
  seated: '¡Buen provecho!',
  cancelled: 'Cancelaste tu turno',
  no_show: 'Tu turno se cerró porque no llegaste',
  removed: 'El local quitó tu turno de la cola',
}

// Iconos puramente decorativos por estado final (no hay ninguno en el prototipo
// para estos casos): un cierre sobrio, sin depender de una libreria de iconos.
const FINAL_ICONS: Record<string, string> = {
  seated: '✓',
  cancelled: '✕',
  no_show: '○',
  removed: '↩',
}

/**
 * Progreso presentacional de la barra de espera (0..1). No agrega estado de
 * negocio nuevo: se deriva en cada render de `wait_min` / `groups_ahead` /
 * `joined_at`, que ya vienen del backend (nota tecnica seccion 3).
 *
 * Combina dos señales y se queda con la mayor: el tiempo transcurrido (que al
 * unirse recien es casi 0) y el avance de puesto (`maxAhead`, el mayor
 * `groups_ahead` visto en esta pantalla). Asi, cuando alguien que estaba
 * adelante sale de la cola, la barra salta de inmediato aunque acabes de
 * unirte.
 */
function computeProgress(entry: EntryPublic, maxAhead: number): number {
  if (entry.wait_min === null || entry.groups_ahead === null) return 0.04

  const elapsedMin = Math.max(0, (Date.now() - new Date(entry.joined_at).getTime()) / 60_000)
  const remainingMin = (entry.wait_min[0] + entry.wait_min[1]) / 2
  const total = elapsedMin + remainingMin
  const progressByTime = total > 0 ? elapsedMin / total : 0.04

  const progressByPosition = (maxAhead - entry.groups_ahead + 1) / (maxAhead + 1)

  let progress = Math.max(progressByTime, progressByPosition)
  if (entry.groups_ahead === 0) {
    progress = Math.max(progress, 0.85)
  }
  return Math.min(0.96, Math.max(0.04, progress))
}

export function TurnPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [entry, setEntry] = useState<EntryPublic | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [offline, setOffline] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [changedNotice, setChangedNotice] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState(false)

  // Se incrementa al iniciar cada refresh (polling) y cada accion. Si al
  // resolver una respuesta el contador ya avanzo, es porque se lanzo algo mas
  // nuevo mientras tanto: se descarta (evita, p. ej., que un GET de polling
  // atrasado vuelva a mostrar "En espera" despues de tocar "Ya no voy").
  const requestIdRef = useRef(0)
  // Espejo de `actionPending` en un ref: permite que el tick de polling se
  // salte sin tener que recrear su callback cada vez que actionPending cambia.
  const actionPendingRef = useRef(false)

  // Guarda o borra el token de este turno bajo su slug, sin pisar el token de
  // otro turno mas nuevo que el comensal haya guardado ahi mientras tanto.
  const syncStorage = useCallback(
    (data: EntryPublic) => {
      const storedToken = getTurnToken(data.location.slug)
      if (data.status === 'waiting' || data.status === 'called') {
        if (storedToken === null || storedToken === token) {
          setTurnToken(data.location.slug, token)
        }
      } else if (storedToken === token) {
        clearTurnToken(data.location.slug)
      }
    },
    [token],
  )

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    try {
      const data = await getEntry(token)
      if (requestIdRef.current !== requestId) return
      setEntry(data)
      setNotFound(false)
      setOffline(false)
      setActionError(null)
      setLastUpdated(new Date())
      syncStorage(data)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
        clearTurnTokenIfMatches(token)
      } else {
        setOffline(true)
      }
    }
  }, [token, syncStorage])

  // Lo que dispara el polling: mientras haya una accion en curso, no lanza un
  // GET nuevo (evita que un tick de 15s lea el estado justo antes de que el
  // backend confirme "Ya no voy" / "Voy en camino"). `refresh` en si no tiene
  // este freno: las acciones lo siguen usando directo para refrescar tras un 409.
  const pollTick = useCallback(() => {
    if (actionPendingRef.current) return
    return refresh()
  }, [refresh])

  usePolling(pollTick, TURN_POLL_INTERVAL_MS)

  async function handleCancel(): Promise<void> {
    if (!window.confirm('¿Seguro que ya no vas?')) return
    actionPendingRef.current = true
    setActionPending(true)
    try {
      const data = await cancelEntry(token)
      // La respuesta de la accion siempre gana: descarta cualquier GET de
      // polling que estuviera en curso (pudo haber leido el estado anterior).
      requestIdRef.current += 1
      setEntry(data)
      syncStorage(data)
      setChangedNotice(false)
      setActionError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        requestIdRef.current += 1
        setChangedNotice(true)
        await refresh()
      } else {
        setActionError('Sin conexión. Vuelve a intentarlo.')
      }
    } finally {
      actionPendingRef.current = false
      setActionPending(false)
    }
  }

  async function handleOnMyWay(): Promise<void> {
    actionPendingRef.current = true
    setActionPending(true)
    try {
      const data = await onMyWay(token)
      requestIdRef.current += 1
      setEntry(data)
      syncStorage(data)
      setChangedNotice(false)
      setActionError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        requestIdRef.current += 1
        setChangedNotice(true)
        await refresh()
      } else {
        setActionError('Sin conexión. Vuelve a intentarlo.')
      }
    } finally {
      actionPendingRef.current = false
      setActionPending(false)
    }
  }

  if (notFound) {
    return (
      <div className="app-shell">
        <main className="card state-card">
          <p className="state-message">No encontramos este turno</p>
        </main>
      </div>
    )
  }

  if (!entry) {
    return (
      <div className="app-shell">
        <main className="card state-card">
          <p className="state-message">Cargando…</p>
        </main>
      </div>
    )
  }

  const formattedTime = lastUpdated
    ? lastUpdated.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    : ''

  const finalMessage = FINAL_MESSAGES[entry.status]

  return (
    <div className="app-shell">
      <main className="card turn-page">
        <div className="card-notch" aria-hidden="true" />
        <header className="card-header">
          <h1>{entry.location.name}</h1>
        </header>

        {offline ? <p className="offline-banner">Sin conexión · última actualización {formattedTime}</p> : null}
        {changedNotice ? <p className="notice">Tu turno cambió</p> : null}
        {actionError ? <p className="notice">{actionError}</p> : null}

        {entry.status === 'waiting' ? (
          <WaitingView entry={entry} onCancel={handleCancel} disabled={actionPending} />
        ) : null}

        {entry.status === 'called' ? (
          <CalledView entry={entry} onCancel={handleCancel} onOnMyWay={handleOnMyWay} disabled={actionPending} />
        ) : null}

        {finalMessage ? <FinalView message={finalMessage} slug={entry.location.slug} status={entry.status} /> : null}
      </main>
    </div>
  )
}

function WaitingView({
  entry,
  onCancel,
  disabled,
}: {
  entry: EntryPublic
  onCancel: () => void
  disabled: boolean
}) {
  const groupsAhead = entry.groups_ahead
  const waitMin = entry.wait_min
  const hasWait = groupsAhead !== null && waitMin !== null
  const isNext = hasWait && groupsAhead === 0

  // Mayor `groups_ahead` visto hasta ahora en esta pantalla (ver computeProgress).
  // Mutar un ref durante el render es seguro aqui: solo puede crecer (Math.max),
  // asi que es idempotente si React vuelve a renderizar (StrictMode).
  const maxAheadRef = useRef(0)
  if (groupsAhead !== null) {
    maxAheadRef.current = Math.max(maxAheadRef.current, groupsAhead)
  }

  const progress = hasWait ? computeProgress(entry, maxAheadRef.current) : 0.04

  // El puesto es lo grande de la pantalla y el tiempo estimado va debajo, mas
  // chico: el puesto es un hecho (los de adelante nunca aumentan) y el tiempo
  // es lo que puede fallar. El backend lo manda siempre mientras la entrada
  // este en waiting; el chequeo de null solo cubre el resto de estados. El
  // texto "Tu puesto: N" queda oculto para lectores de pantalla.
  const hasPosition = entry.position !== null

  const timeBlock = hasWait ? (
    <>
      <p className={isNext ? 'wait-kicker accent' : 'wait-kicker'}>
        {isNext ? 'Eres el siguiente' : 'Tiempo estimado'}
      </p>
      {/* Texto exacto que ya buscan los tests (waitText); version visual abajo. */}
      <p className="sr-only">{waitText(groupsAhead, waitMin)}</p>
      <div
        key={isNext ? `next-${waitMin[1]}` : `range-${waitMin[0]}-${waitMin[1]}`}
        className={hasPosition ? 'wait-medium-wrap' : 'wait-big-wrap'}
        aria-hidden="true"
      >
        <p className={hasPosition ? 'wait-medium' : 'wait-big'}>
          {isNext ? (
            `~${waitMin[1]}`
          ) : (
            <>
              {waitMin[0]}
              <span className="wait-dash">–</span>
              {waitMin[1]}
            </>
          )}
          <span className="wait-unit">min</span>
        </p>
      </div>
    </>
  ) : null

  return (
    <section className="turn-waiting">
      {hasPosition ? (
        <>
          <p className="wait-kicker">Estás en el puesto</p>
          <div key={entry.position} className="wait-big-wrap" aria-hidden="true">
            <p className="wait-big">{entry.position}</p>
          </div>
          <p className="sr-only">Tu puesto: {entry.position}</p>
          {timeBlock}
        </>
      ) : (
        timeBlock
      )}

      {hasWait ? (
        <div
          className="progress-bar"
          role="progressbar"
          aria-label="Avance en la cola"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
      ) : null}

      {entry.sms_supported ? (
        <p className="turn-sub">Te avisaremos por SMS cuando tu mesa esté lista.</p>
      ) : (
        <p className="callout warn">No te llegará un mensaje. Mantén esta pantalla abierta.</p>
      )}

      <dl className="turn-details">
        <dt>Nombre</dt>
        <dd>{entry.name}</dd>
        <dt>Personas</dt>
        <dd>{entry.party_size}</dd>
        <dt>Teléfono</dt>
        <dd>{entry.phone}</dd>
      </dl>

      <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={disabled}>
        Ya no voy
      </button>
    </section>
  )
}

function CalledView({
  entry,
  onCancel,
  onOnMyWay,
  disabled,
}: {
  entry: EntryPublic
  onCancel: () => void
  onOnMyWay: () => void
  disabled: boolean
}) {
  return (
    <section className="turn-called">
      <h2>¡Es tu turno!</h2>
      <p className="turn-sub-lead">Acércate a la entrada</p>
      {entry.on_my_way ? (
        <p className="turn-confirmed">
          <span className="check" aria-hidden="true">
            ✓
          </span>
          <span>Avisamos que vas en camino</span>
        </p>
      ) : (
        <button type="button" className="btn btn-on-accent" onClick={onOnMyWay} disabled={disabled}>
          Voy en camino
        </button>
      )}
      <button type="button" className="btn btn-ghost-on-accent" onClick={onCancel} disabled={disabled}>
        Ya no voy
      </button>
    </section>
  )
}

function FinalView({ message, slug, status }: { message: string; slug: string; status: EntryStatus }) {
  return (
    <section className="turn-final">
      <p className="final-icon" aria-hidden="true">
        {FINAL_ICONS[status] ?? '•'}
      </p>
      <p className="final-message">{message}</p>
      <Link to={`/l/${slug}`} className="btn btn-primary">
        Volver a unirme
      </Link>
    </section>
  )
}
