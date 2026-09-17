import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { JoinPage } from './JoinPage'
import { installFetchMock, type MockRoute } from '../testSupport/mockFetch'
import type { EntryStatus } from '../api/types'

// Formulario para unirse a la cola (NOTA_TECNICA.md, seccion 3): la clave de
// idempotencia evita perder el turno en un doble toque, el consentimiento es
// obligatorio, y un telefono duplicado o el limite de intentos no deben
// romper la pantalla.

const SLUG = 'demo-lima'
const LOCATION_ROUTE: MockRoute = {
  method: 'GET',
  match: new RegExp(`^/api/locations/${SLUG}$`),
  responses: [{ status: 200, body: { slug: SLUG, name: 'Demo Lima' } }],
}

function entryFixture(overrides: Partial<Record<string, unknown>> & { status: EntryStatus }) {
  const defaults = {
    public_token: 'tok-123',
    name: 'Ana Torres',
    phone: '+51987654321',
    party_size: 2,
    location: { slug: SLUG, name: 'Demo Lima' },
    groups_ahead: 1,
    position: null,
    wait_min: [12, 24],
    sms_supported: true,
    joined_at: '2026-01-01T12:00:00Z',
    on_my_way: false,
  }
  return {
    ...defaults,
    ...overrides,
  }
}

function noExistingTurnRoute(token: string): MockRoute {
  // Se usa cuando el flujo de un test deja un token guardado en storage de un
  // envio anterior (p. ej. tras unirse con exito): sin este mock, JoinPage
  // pediria GET /api/entries/{token} al montar de nuevo y, al no encontrar
  // ruta, el helper de mocks lo convertiria en un error de red silencioso.
  return {
    method: 'GET',
    match: new RegExp(`^/api/entries/${token}$`),
    responses: [{ status: 404, body: { detail: { code: 'not_found' } } }],
  }
}

function renderJoinPage(initialPath = `/l/${SLUG}`) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/l/:slug" element={<JoinPage />} />
        <Route path="/t/:token" element={<p>TurnPageStub</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(screen.getByLabelText('Nombre'))
  await user.type(screen.getByLabelText('Nombre'), 'Ana Torres')
  await user.clear(screen.getByLabelText('Celular'))
  await user.type(screen.getByLabelText('Celular'), '987654321')
  await user.click(screen.getByRole('checkbox'))
}

function joinRoute(responses: MockRoute['responses']): MockRoute {
  return {
    method: 'POST',
    match: new RegExp(`^/api/locations/${SLUG}/entries$`),
    responses,
  }
}

describe('JoinPage: envio y clave de idempotencia', () => {
  it('envia el header Idempotency-Key al unirse', async () => {
    const { calls } = installFetchMock([
      LOCATION_ROUTE,
      joinRoute([{ status: 201, body: entryFixture({ status: 'waiting' }) }]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))

    await screen.findByText('TurnPageStub')

    const postCall = calls.find((c) => c.method === 'POST')
    expect(postCall).toBeDefined()
    expect(postCall?.headers['Idempotency-Key']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reintenta tras un error de red reusando la misma Idempotency-Key', async () => {
    const { calls } = installFetchMock([
      LOCATION_ROUTE,
      joinRoute([{ status: 0, body: undefined }, { status: 201, body: entryFixture({ status: 'waiting' }) }]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))
    await screen.findByText('Sin conexión. Vuelve a intentarlo.')

    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))
    await screen.findByText('TurnPageStub')

    const postCalls = calls.filter((c) => c.method === 'POST')
    expect(postCalls).toHaveLength(2)
    expect(postCalls[0].headers['Idempotency-Key']).toBe(postCalls[1].headers['Idempotency-Key'])
  })

  it('al desmontar y volver a montar el formulario genera una clave distinta', async () => {
    const { calls } = installFetchMock([
      LOCATION_ROUTE,
      // El primer envio con exito deja guardado 'tok-123' bajo el slug; al
      // volver a montar, JoinPage comprueba ese turno antes de mostrar el
      // formulario de nuevo, asi que hay que mockear esa consulta tambien.
      noExistingTurnRoute('tok-123'),
      joinRoute([
        { status: 201, body: entryFixture({ status: 'waiting' }) },
        { status: 201, body: entryFixture({ status: 'waiting' }) },
      ]),
    ])
    const user = userEvent.setup()

    const first = renderJoinPage()
    await screen.findByText('Demo Lima')
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))
    await screen.findByText('TurnPageStub')
    first.unmount()

    renderJoinPage()
    await screen.findByText('Demo Lima')
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))
    await screen.findByText('TurnPageStub')

    const postCalls = calls.filter((c) => c.method === 'POST')
    expect(postCalls).toHaveLength(2)
    expect(postCalls[0].headers['Idempotency-Key']).not.toBe(postCalls[1].headers['Idempotency-Key'])
  })
})

describe('JoinPage: formulario', () => {
  it('el stepper de "Cuántos son" arranca en 2, tiene limites 1-20, y el valor elegido va en el body', async () => {
    const { calls } = installFetchMock([
      LOCATION_ROUTE,
      joinRoute([{ status: 201, body: entryFixture({ status: 'waiting' }) }]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    const group = screen.getByRole('group', { name: 'Cuántos son' })
    const decrement = within(group).getByRole('button', { name: 'Quitar una persona' })
    const increment = within(group).getByRole('button', { name: 'Agregar una persona' })

    expect(within(group).getByText('2')).toBeInTheDocument()
    expect(decrement).not.toBeDisabled()
    expect(increment).not.toBeDisabled()

    // "-" baja hasta 1 y ahi queda desactivado; no baja mas alla
    await user.click(decrement)
    expect(within(group).getByText('1')).toBeInTheDocument()
    expect(decrement).toBeDisabled()
    await user.click(decrement)
    expect(within(group).getByText('1')).toBeInTheDocument()

    // "+" sube hasta 20 y ahi queda desactivado; no sube mas alla
    for (let i = 0; i < 19; i += 1) {
      await user.click(increment)
    }
    expect(within(group).getByText('20')).toBeInTheDocument()
    expect(increment).toBeDisabled()
    await user.click(increment)
    expect(within(group).getByText('20')).toBeInTheDocument()

    // baja a 5, que es el valor que se termina enviando
    for (let i = 0; i < 15; i += 1) {
      await user.click(decrement)
    }
    expect(within(group).getByText('5')).toBeInTheDocument()

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))

    await screen.findByText('TurnPageStub')
    const postCall = calls.find((c) => c.method === 'POST')
    const body = JSON.parse(postCall?.body ?? '{}') as { party_size: number }
    expect(body.party_size).toBe(5)
  })

  it('muestra el texto de consentimiento y la letra chica sobre los 30 dias', async () => {
    installFetchMock([LOCATION_ROUTE])
    renderJoinPage()

    await screen.findByText('Demo Lima')
    expect(
      screen.getByText('Usaremos tu nombre y celular solo para avisarte de tu turno.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Tus datos se borran a los 30 días.')).toBeInTheDocument()
  })

  it('sin la casilla de consentimiento marcada no envia el formulario', async () => {
    const { calls } = installFetchMock([
      LOCATION_ROUTE,
      joinRoute([{ status: 201, body: entryFixture({ status: 'waiting' }) }]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await user.type(screen.getByLabelText('Nombre'), 'Ana Torres')
    await user.type(screen.getByLabelText('Celular'), '987654321')
    // Consentimiento deliberadamente sin marcar.
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))

    await screen.findByText('Debes aceptar para continuar')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('muestra el aviso de "otro pais" al elegir esa opcion', async () => {
    installFetchMock([LOCATION_ROUTE])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await user.selectOptions(screen.getByLabelText('País'), 'OTHER')

    expect(
      screen.getByText(
        'A números fuera de Perú y Chile no les llega SMS. Podrás unirte igual: mantén abierta la pantalla de tu turno.',
      ),
    ).toBeInTheDocument()
  })
})

describe('JoinPage: errores al enviar', () => {
  it('muestra el mensaje de 409 already_in_queue', async () => {
    installFetchMock([
      LOCATION_ROUTE,
      joinRoute([{ status: 409, body: { detail: { code: 'already_in_queue' } } }]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))

    await screen.findByText(
      'Este teléfono ya está en la cola de hoy. Si perdiste tu turno, pídele al anfitrión que lo recupere.',
    )
  })

  it('429 con Retry-After 90s dice "en 2 minutos"', async () => {
    installFetchMock([
      LOCATION_ROUTE,
      joinRoute([
        { status: 429, body: { detail: { code: 'rate_limited' } }, headers: { 'Retry-After': '90' } },
      ]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))

    await screen.findByText('Demasiados intentos. Vuelve a intentarlo en 2 minutos.')
  })

  it('429 con Retry-After 60s dice "en 1 minuto" (singular)', async () => {
    installFetchMock([
      LOCATION_ROUTE,
      joinRoute([
        { status: 429, body: { detail: { code: 'rate_limited' } }, headers: { 'Retry-After': '60' } },
      ]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))

    await screen.findByText('Demasiados intentos. Vuelve a intentarlo en 1 minuto.')
  })

  it('429 con Retry-After 3600s dice "en 60 minutos"', async () => {
    installFetchMock([
      LOCATION_ROUTE,
      joinRoute([
        { status: 429, body: { detail: { code: 'rate_limited' } }, headers: { 'Retry-After': '3600' } },
      ]),
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /Unirme a la cola/i }))

    await screen.findByText('Demasiados intentos. Vuelve a intentarlo en 60 minutos.')
  })
})

describe('JoinPage: turno guardado al abrir la pantalla', () => {
  it('con un turno activo guardado en storage, redirige a /t/{token}', async () => {
    window.localStorage.setItem(`mesa247:turn:${SLUG}`, 'tok-activo')
    installFetchMock([
      LOCATION_ROUTE,
      {
        method: 'GET',
        match: /^\/api\/entries\/tok-activo$/,
        responses: [{ status: 200, body: entryFixture({ status: 'waiting', public_token: 'tok-activo' }) }],
      },
    ])
    renderJoinPage()

    await screen.findByText('TurnPageStub')
  })

  it('con un turno final guardado, muestra el formulario y borra la clave de storage', async () => {
    window.localStorage.setItem(`mesa247:turn:${SLUG}`, 'tok-final')
    installFetchMock([
      LOCATION_ROUTE,
      {
        method: 'GET',
        match: /^\/api\/entries\/tok-final$/,
        responses: [{ status: 200, body: entryFixture({ status: 'seated', public_token: 'tok-final' }) }],
      },
    ])
    renderJoinPage()

    await screen.findByText('Demo Lima')
    await screen.findByLabelText('Nombre')

    await waitFor(() => {
      expect(window.localStorage.getItem(`mesa247:turn:${SLUG}`)).toBeNull()
    })
  })
})

describe('JoinPage: error al cargar el local', () => {
  it('404 muestra "No encontramos este local"', async () => {
    installFetchMock([{ ...LOCATION_ROUTE, responses: [{ status: 404, body: { detail: { code: 'not_found' } } }] }])
    renderJoinPage()

    await screen.findByText('No encontramos este local')
  })

  it('un error de red muestra el aviso y "Reintentar" vuelve a pedirlo y muestra el formulario', async () => {
    installFetchMock([
      {
        ...LOCATION_ROUTE,
        responses: [
          { status: 0, body: undefined },
          { status: 200, body: { slug: SLUG, name: 'Demo Lima' } },
        ],
      },
    ])
    const user = userEvent.setup()
    renderJoinPage()

    await screen.findByText('Sin conexión. Vuelve a intentarlo.')
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    await screen.findByText('Demo Lima')
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument()
  })
})
