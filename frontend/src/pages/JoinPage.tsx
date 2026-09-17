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

const PARTY_SIZE_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1)

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
    return <p>Cargando…</p>
  }

  if (loadState.kind === 'not_found') {
    return <p>No encontramos este local</p>
  }

  if (loadState.kind === 'error') {
    return (
      <main>
        <p className="form-error">Sin conexión. Vuelve a intentarlo.</p>
        <button type="button" onClick={handleRetryLoad}>
          Reintentar
        </button>
      </main>
    )
  }

  return (
    <main className="join-page">
      <h1>{loadState.location.name}</h1>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="name">Nombre</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        {errors.name ? <p className="field-error">{errors.name}</p> : null}

        <PhoneInput
          country={country}
          rawValue={phoneRaw}
          onCountryChange={setCountry}
          onRawValueChange={setPhoneRaw}
          error={errors.phone}
        />

        <label htmlFor="party-size">Cuántos son</label>
        <select id="party-size" value={partySize} onChange={(e) => setPartySize(Number(e.target.value))}>
          {PARTY_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <label className="consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Acepto que se use mi nombre y teléfono solo para avisarme de mi turno. Se eliminan a los 30 días.
        </label>
        {errors.consent ? <p className="field-error">{errors.consent}</p> : null}

        {formError ? <p className="form-error">{formError}</p> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Enviando…' : 'Unirme a la cola'}
        </button>
      </form>
    </main>
  )
}
