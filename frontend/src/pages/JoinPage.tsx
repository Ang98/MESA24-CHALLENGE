import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PhoneInput } from '../components/PhoneInput'
import { ApiError } from '../api/client'
import { getEntry, getLocation, joinQueue } from '../api/public'
import type { LocationPublic } from '../api/types'
import { generateIdempotencyKey } from '../lib/idempotency'
import { buildE164, validatePhone, type CountryCode } from '../lib/phone'
import { clearTurnToken, getTurnToken, setTurnToken } from '../lib/storage'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ready'; location: LocationPublic }

interface FieldErrors {
  name?: string
  phone?: string
  consent?: string
}

const MIN_PARTY_SIZE = 1
const MAX_PARTY_SIZE = 20

export function JoinPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  // Una clave por cada apertura (montaje) del formulario: reintentos la reusan,
  // un nuevo montaje genera una distinta.
  const idempotencyKeyRef = useRef(generateIdempotencyKey())

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' })
  const [checkingExisting, setCheckingExisting] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [name, setName] = useState('')
  const [country, setCountry] = useState<CountryCode>('PE')
  const [phoneRaw, setPhoneRaw] = useState('')
  const [partySize, setPartySize] = useState(2)
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const location = await getLocation(slug)
        if (cancelled) return
        setLoadState({ kind: 'ready', location })

        const existingToken = getTurnToken(slug)
        if (existingToken) {
          try {
            const entry = await getEntry(existingToken)
            if (cancelled) return
            if (entry.status === 'waiting' || entry.status === 'called') {
              navigate(`/t/${existingToken}`, { replace: true })
              return
            }
            clearTurnToken(slug)
          } catch (err) {
            if (err instanceof ApiError && err.status === 404) {
              clearTurnToken(slug)
            }
          }
        }
        if (!cancelled) setCheckingExisting(false)
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setLoadState({ kind: 'not_found' })
        } else {
          setLoadState({ kind: 'error' })
        }
        setCheckingExisting(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [slug, navigate, reloadKey])

  function handleRetryLoad(): void {
    setLoadState({ kind: 'loading' })
    setCheckingExisting(true)
    setReloadKey((key) => key + 1)
  }

  function handlePartySizeDecrement(): void {
    setPartySize((n) => Math.max(MIN_PARTY_SIZE, n - 1))
  }

  function handlePartySizeIncrement(): void {
    setPartySize((n) => Math.min(MAX_PARTY_SIZE, n + 1))
  }

  function validate(): boolean {
    const nextErrors: FieldErrors = {}
    const trimmedName = name.trim()
    if (trimmedName.length < 1 || trimmedName.length > 60) {
      nextErrors.name = 'Ingresa un nombre de hasta 60 caracteres'
    }
    const phoneResult = validatePhone(country, phoneRaw)
    if (!phoneResult.valid) {
      nextErrors.phone = phoneResult.error
    }
    if (!consent) {
      nextErrors.consent = 'Debes aceptar para continuar'
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setFormError(null)
    if (!validate()) return

    setSubmitting(true)
    try {
      const entry = await joinQueue(
        slug,
        {
          name: name.trim(),
          phone: buildE164(country, phoneRaw),
          party_size: partySize,
          consent: true,
        },
        idempotencyKeyRef.current,
      )
      setTurnToken(slug, entry.public_token)
      navigate(`/t/${entry.public_token}`)
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 0) {
          setFormError('Sin conexión. Vuelve a intentarlo.')
        } else if (err.status === 409) {
          setFormError(
            'Este teléfono ya está en la cola de hoy. Si perdiste tu turno, pídele al anfitrión que lo recupere.',
          )
        } else if (err.status === 429) {
          const minutes = Math.max(1, Math.ceil((err.retryAfter ?? 60) / 60))
          const unit = minutes === 1 ? 'minuto' : 'minutos'
          setFormError(`Demasiados intentos. Vuelve a intentarlo en ${minutes} ${unit}.`)
        } else {
          setFormError('Revisa los datos ingresados')
        }
      } else {
        setFormError('Sin conexión. Vuelve a intentarlo.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loadState.kind === 'loading' || checkingExisting) {
    return (
      <div className="app-shell">
        <main className="card state-card">
          <p className="state-message">Cargando…</p>
        </main>
      </div>
    )
  }

  if (loadState.kind === 'not_found') {
    return (
      <div className="app-shell">
        <main className="card state-card">
          <p className="state-message">No encontramos este local</p>
        </main>
      </div>
    )
  }

  if (loadState.kind === 'error') {
    return (
      <div className="app-shell">
        <main className="card state-card">
          <p className="callout form-error">Sin conexión. Vuelve a intentarlo.</p>
          <button type="button" className="btn btn-ghost" onClick={handleRetryLoad}>
            Reintentar
          </button>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="card join-page">
        <div className="card-notch" aria-hidden="true" />
        <header className="card-header">
          <h1>{loadState.location.name}</h1>
          <p className="sub">Lista de espera · hoy</p>
        </header>

        <form onSubmit={handleSubmit} noValidate className="form">
          <div className="field">
            <label htmlFor="name" className="field-label">
              Nombre
            </label>
            <input
              id="name"
              className="input-text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
            {errors.name ? <p className="field-error">{errors.name}</p> : null}
          </div>

          <PhoneInput
            country={country}
            rawValue={phoneRaw}
            onCountryChange={setCountry}
            onRawValueChange={setPhoneRaw}
            error={errors.phone}
          />

          <div className="field">
            <span id="party-size-label" className="field-label">
              Cuántos son
            </span>
            <div className="stepper" role="group" aria-labelledby="party-size-label">
              <button
                type="button"
                className="stepper-btn"
                onClick={handlePartySizeDecrement}
                disabled={partySize <= MIN_PARTY_SIZE}
                aria-label="Quitar una persona"
              >
                −
              </button>
              <span className="stepper-value" aria-live="polite">
                {partySize}
              </span>
              <button
                type="button"
                className="stepper-btn"
                onClick={handlePartySizeIncrement}
                disabled={partySize >= MAX_PARTY_SIZE}
                aria-label="Agregar una persona"
              >
                +
              </button>
            </div>
          </div>

          <div className="field">
            <label className="consent">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Usaremos tu nombre y celular solo para avisarte de tu turno.</span>
            </label>
            <p className="consent-fine-print">Tus datos se borran a los 30 días.</p>
            {errors.consent ? <p className="field-error">{errors.consent}</p> : null}
          </div>

          {formError ? <p className="callout form-error">{formError}</p> : null}

          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Enviando…' : 'Unirme a la cola'}
          </button>
        </form>
      </main>
    </div>
  )
}
