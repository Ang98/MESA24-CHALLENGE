import { useCallback, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { cancelEntry, getEntry, onMyWay } from '../api/public'
import type { EntryPublic } from '../api/types'
import { TURN_POLL_INTERVAL_MS, usePolling } from '../lib/usePolling'
import { clearTurnToken, clearTurnTokenIfMatches, getTurnToken, setTurnToken } from '../lib/storage'
import { waitText } from '../lib/waitText'

const FINAL_MESSAGES: Record<string, string> = {
  seated: '¡Buen provecho!',
  cancelled: 'Cancelaste tu turno',
  no_show: 'Tu turno se cerró porque no llegaste',
  removed: 'El local quitó tu turno de la cola',
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
    return <p>No encontramos este turno</p>
  }

  if (!entry) {
    return <p>Cargando…</p>
  }

  const formattedTime = lastUpdated
    ? lastUpdated.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    : ''

  const finalMessage = FINAL_MESSAGES[entry.status]

  return (
    <main className="turn-page">
      <h1>{entry.location.name}</h1>
      <dl className="turn-details">
        <dt>Nombre</dt>
        <dd>{entry.name}</dd>
        <dt>Personas</dt>
        <dd>{entry.party_size}</dd>
        <dt>Teléfono</dt>
        <dd>{entry.phone}</dd>
      </dl>

      {!entry.sms_supported ? (
        <p className="notice">No te llegará SMS. Mantén esta pantalla abierta.</p>
      ) : null}

      {offline ? <p className="offline-banner">Sin conexión · última actualización {formattedTime}</p> : null}
      {changedNotice ? <p className="notice">Tu turno cambió</p> : null}
      {actionError ? <p className="notice">{actionError}</p> : null}

      {entry.status === 'waiting' ? (
        <WaitingView entry={entry} onCancel={handleCancel} disabled={actionPending} />
      ) : null}

      {entry.status === 'called' ? (
        <CalledView entry={entry} onCancel={handleCancel} onOnMyWay={handleOnMyWay} disabled={actionPending} />
      ) : null}

      {finalMessage ? <FinalView message={finalMessage} slug={entry.location.slug} /> : null}
    </main>
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
  return (
    <section>
      {entry.groups_ahead !== null && entry.wait_min !== null ? (
        <p className="wait-time">{waitText(entry.groups_ahead, entry.wait_min)}</p>
      ) : null}
      {entry.position !== null ? (
        <p key={entry.position} className="position">
          Tu puesto: {entry.position}
        </p>
      ) : null}
      <button type="button" onClick={onCancel} disabled={disabled}>
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
    <section>
      <h2>¡Es tu turno!</h2>
      <p>Acércate a la entrada</p>
      {entry.on_my_way ? (
        <p>Avisamos que vas en camino</p>
      ) : (
        <button type="button" onClick={onOnMyWay} disabled={disabled}>
          Voy en camino
        </button>
      )}
      <button type="button" onClick={onCancel} disabled={disabled}>
        Ya no voy
      </button>
    </section>
  )
}

function FinalView({ message, slug }: { message: string; slug: string }) {
  return (
    <section>
      <p>{message}</p>
      <Link to={`/l/${slug}`}>Volver a unirme</Link>
    </section>
  )
}
