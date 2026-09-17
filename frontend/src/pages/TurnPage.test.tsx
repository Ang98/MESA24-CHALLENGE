import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnPage } from './TurnPage'
import { installFetchMock, type MockRoute } from '../testSupport/mockFetch'
import type { EntryStatus } from '../api/types'

// Pantalla del turno del comensal (NOTA_TECNICA.md, seccion 2 y 3): tiempo de
// espera como rango, puesto solo del 3er lugar en adelante, "Voy en camino"
// como evento y no como estado, y el turno guardado en localStorage bajo el
// slug del local.

const SLUG = 'demo-lima'
const TOKEN = 'tok-1'

function entryFixture(overrides: Partial<Record<string, unknown>> & { status: EntryStatus }) {
  const defaults = {
    public_token: TOKEN,
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

function entryRoute(responses: MockRoute['responses'], token = TOKEN): MockRoute {
  return { method: 'GET', match: new RegExp(`^/api/entries/${token}$`), responses }
}

function renderTurnPage(token = TOKEN) {
  return render(
    <MemoryRouter initialEntries={[`/t/${token}`]}>
      <Routes>
        <Route path="/t/:token" element={<TurnPage />} />
        <Route path="/l/:slug" element={<p>JoinPageStub</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  // El global afterEach de setupTests.ts (vi.restoreAllMocks) deshace este spy.
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('TurnPage: waiting', () => {
  it('muestra el puesto cuando position no es null', async () => {
    installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status: 'waiting', position: 3 }) }])])
    renderTurnPage()

    await screen.findByText('Tu puesto: 3')
  })

  it('no muestra puesto cuando position es null', async () => {
    installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status: 'waiting', position: null }) }])])
    renderTurnPage()

    await screen.findByText('Ya no voy')
    expect(screen.queryByText(/Tu puesto:/)).not.toBeInTheDocument()
  })

  it('groups_ahead 0 muestra "Eres el siguiente · ~{b} min"', async () => {
    installFetchMock([
      entryRoute([{ status: 200, body: entryFixture({ status: 'waiting', groups_ahead: 0, wait_min: [12, 12] }) }]),
    ])
    renderTurnPage()

    await screen.findByText('Eres el siguiente · ~12 min')
  })

  it('groups_ahead > 0 muestra "Entre {a} y {b} min"', async () => {
    installFetchMock([
      entryRoute([{ status: 200, body: entryFixture({ status: 'waiting', groups_ahead: 2, wait_min: [24, 36] }) }]),
    ])
    renderTurnPage()

    await screen.findByText('Entre 24 y 36 min')
  })
})

describe('TurnPage: called', () => {
  it('muestra el boton "Voy en camino" cuando on_my_way es false', async () => {
    installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status: 'called', on_my_way: false }) }])])
    renderTurnPage()

    await screen.findByText('¡Es tu turno!')
    expect(screen.getByRole('button', { name: 'Voy en camino' })).toBeInTheDocument()
  })

  it('al confirmar "Voy en camino" el backend responde y oculta el boton', async () => {
    installFetchMock([
      entryRoute([{ status: 200, body: entryFixture({ status: 'called', on_my_way: false }) }]),
      {
        method: 'POST',
        match: new RegExp(`^/api/entries/${TOKEN}/on-my-way$`),
        responses: [{ status: 200, body: entryFixture({ status: 'called', on_my_way: true }) }],
      },
    ])
    const user = userEvent.setup()
    renderTurnPage()

    await screen.findByText('¡Es tu turno!')
    await user.click(screen.getByRole('button', { name: 'Voy en camino' }))

    await screen.findByText('Avisamos que vas en camino')
    expect(screen.queryByRole('button', { name: 'Voy en camino' })).not.toBeInTheDocument()
  })

  it('muestra el texto sin boton cuando on_my_way ya es true al cargar', async () => {
    installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status: 'called', on_my_way: true }) }])])
    renderTurnPage()

    await screen.findByText('Avisamos que vas en camino')
    expect(screen.queryByRole('button', { name: 'Voy en camino' })).not.toBeInTheDocument()
  })
})

describe('TurnPage: "Ya no voy"', () => {
  it('al confirmar, cancela y borra el token guardado sin esperar al siguiente sondeo', async () => {
    window.localStorage.setItem(`mesa247:turn:${SLUG}`, TOKEN)
    installFetchMock([
      entryRoute([{ status: 200, body: entryFixture({ status: 'waiting' }) }]),
      {
        method: 'POST',
        match: new RegExp(`^/api/entries/${TOKEN}/cancel$`),
        responses: [{ status: 200, body: entryFixture({ status: 'cancelled' }) }],
      },
    ])
    const user = userEvent.setup()
    renderTurnPage()

    await screen.findByRole('button', { name: 'Ya no voy' })
    await user.click(screen.getByRole('button', { name: 'Ya no voy' }))

    await screen.findByText('Cancelaste tu turno')
    expect(window.localStorage.getItem(`mesa247:turn:${SLUG}`)).toBeNull()
  })

  it('un 409 al cancelar muestra "Tu turno cambió" y vuelve a pedir el turno', async () => {
    const { calls } = installFetchMock([
      entryRoute([
        { status: 200, body: entryFixture({ status: 'waiting' }) },
        { status: 200, body: entryFixture({ status: 'called', on_my_way: false }) },
      ]),
      {
        method: 'POST',
        match: new RegExp(`^/api/entries/${TOKEN}/cancel$`),
        responses: [{ status: 409, body: { detail: { code: 'invalid_transition', current_status: 'called' } } }],
      },
    ])
    const user = userEvent.setup()
    renderTurnPage()

    await screen.findByRole('button', { name: 'Ya no voy' })
    await user.click(screen.getByRole('button', { name: 'Ya no voy' }))

    await screen.findByText('Tu turno cambió')
    await screen.findByText('¡Es tu turno!')

    const getCalls = calls.filter((c) => c.method === 'GET')
    expect(getCalls.length).toBe(2)
  })

  it('un error de red al cancelar muestra el aviso de reintentar y el boton sigue activo; el siguiente GET exitoso lo borra', async () => {
    installFetchMock([
      entryRoute([
        { status: 200, body: entryFixture({ status: 'waiting' }) },
        { status: 200, body: entryFixture({ status: 'waiting' }) },
      ]),
      {
        method: 'POST',
        match: new RegExp(`^/api/entries/${TOKEN}/cancel$`),
        responses: [{ status: 0, body: undefined }],
      },
    ])
    const user = userEvent.setup()
    renderTurnPage()

    await screen.findByRole('button', { name: 'Ya no voy' })
    await user.click(screen.getByRole('button', { name: 'Ya no voy' }))

    await screen.findByText('Sin conexión. Vuelve a intentarlo.')
    expect(screen.getByRole('button', { name: 'Ya no voy' })).not.toBeDisabled()

    // fuerza el siguiente sondeo sin esperar los 15s del intervalo real
    document.dispatchEvent(new Event('visibilitychange'))

    await waitFor(() => {
      expect(screen.queryByText('Sin conexión. Vuelve a intentarlo.')).not.toBeInTheDocument()
    })
  })
})

describe('TurnPage: estados finales', () => {
  const cases: Array<{ status: EntryStatus; message: string }> = [
    { status: 'seated', message: '¡Buen provecho!' },
    { status: 'cancelled', message: 'Cancelaste tu turno' },
    { status: 'no_show', message: 'Tu turno se cerró porque no llegaste' },
    { status: 'removed', message: 'El local quitó tu turno de la cola' },
  ]

  for (const { status, message } of cases) {
    it(`estado ${status} muestra "${message}", el enlace para volver a unirse y borra el token guardado`, async () => {
      window.localStorage.setItem(`mesa247:turn:${SLUG}`, TOKEN)
      installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status }) }])])
      renderTurnPage()

      await screen.findByText(message)
      expect(screen.getByRole('link', { name: 'Volver a unirme' })).toHaveAttribute('href', `/l/${SLUG}`)
      expect(window.localStorage.getItem(`mesa247:turn:${SLUG}`)).toBeNull()
    })
  }

  it('si el token guardado es de otro turno (mas nuevo), un estado final no lo borra', async () => {
    window.localStorage.setItem(`mesa247:turn:${SLUG}`, 'tok-nuevo')
    installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status: 'seated' }) }])])
    renderTurnPage()

    await screen.findByText('¡Buen provecho!')
    expect(window.localStorage.getItem(`mesa247:turn:${SLUG}`)).toBe('tok-nuevo')
  })

  it('si el token guardado es de otro turno (mas nuevo), un estado waiting no lo pisa', async () => {
    window.localStorage.setItem(`mesa247:turn:${SLUG}`, 'tok-nuevo')
    installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status: 'waiting' }) }])])
    renderTurnPage()

    await screen.findByRole('button', { name: 'Ya no voy' })
    expect(window.localStorage.getItem(`mesa247:turn:${SLUG}`)).toBe('tok-nuevo')
  })
})

describe('TurnPage: errores', () => {
  it('404 muestra "No encontramos este turno"', async () => {
    installFetchMock([entryRoute([{ status: 404, body: { detail: { code: 'not_found' } } }])])
    renderTurnPage()

    await screen.findByText('No encontramos este turno')
  })

  it('sms_supported false muestra el aviso de mantener la pantalla abierta', async () => {
    installFetchMock([entryRoute([{ status: 200, body: entryFixture({ status: 'waiting', sms_supported: false }) }])])
    renderTurnPage()

    await screen.findByText('No te llegará SMS. Mantén esta pantalla abierta.')
  })

  it('un error de red durante el sondeo muestra "Sin conexión · última actualización"', async () => {
    installFetchMock([
      entryRoute([
        { status: 200, body: entryFixture({ status: 'waiting' }) },
        { status: 0, body: undefined },
      ]),
    ])
    renderTurnPage()

    await screen.findByRole('button', { name: 'Ya no voy' })

    // fuerza el siguiente sondeo sin esperar los 15s del intervalo real
    document.dispatchEvent(new Event('visibilitychange'))

    await screen.findByText(/Sin conexión · última actualización/)
  })
})

describe('TurnPage: una accion en curso gana sobre un sondeo atrasado', () => {
  it('un GET de sondeo que llega tarde no revierte el resultado de "Ya no voy"', async () => {
    let getCallCount = 0
    let resolveSecondGet: ((res: Response) => void) | undefined
    const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'GET' && url === `/api/entries/${TOKEN}`) {
        getCallCount += 1
        if (getCallCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify(entryFixture({ status: 'waiting' })), { status: 200 }),
          )
        }
        return new Promise<Response>((resolve) => {
          resolveSecondGet = resolve
        })
      }
      if (method === 'POST' && url === `/api/entries/${TOKEN}/cancel`) {
        return Promise.resolve(new Response(JSON.stringify(entryFixture({ status: 'cancelled' })), { status: 200 }))
      }
      return Promise.reject(new Error(`ruta no mockeada: ${method} ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const user = userEvent.setup()
    renderTurnPage()

    await screen.findByRole('button', { name: 'Ya no voy' })
    expect(getCallCount).toBe(1)

    // dispara un segundo GET (el "sondeo atrasado") que se queda pendiente
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(getCallCount).toBe(2))

    // mientras ese GET sigue pendiente, el comensal cancela
    await user.click(screen.getByRole('button', { name: 'Ya no voy' }))
    await screen.findByText('Cancelaste tu turno')

    // el GET atrasado resuelve ahora, con un estado viejo: no debe pisar la cancelacion
    resolveSecondGet?.(new Response(JSON.stringify(entryFixture({ status: 'waiting' })), { status: 200 }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByText('Cancelaste tu turno')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ya no voy' })).not.toBeInTheDocument()
  })

  it('mientras una accion sigue pendiente, un tick de sondeo no dispara un GET nuevo', async () => {
    let getCallCount = 0
    let resolveCancel: ((res: Response) => void) | undefined
    const fetchMock = vi.fn((url: string, init?: { method?: string }) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'GET' && url === `/api/entries/${TOKEN}`) {
        getCallCount += 1
        return Promise.resolve(new Response(JSON.stringify(entryFixture({ status: 'waiting' })), { status: 200 }))
      }
      if (method === 'POST' && url === `/api/entries/${TOKEN}/cancel`) {
        return new Promise<Response>((resolve) => {
          resolveCancel = resolve
        })
      }
      return Promise.reject(new Error(`ruta no mockeada: ${method} ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const user = userEvent.setup()
    renderTurnPage()

    await screen.findByRole('button', { name: 'Ya no voy' })
    expect(getCallCount).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Ya no voy' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ya no voy' })).toBeDisabled())

    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getCallCount).toBe(1)

    resolveCancel?.(new Response(JSON.stringify(entryFixture({ status: 'cancelled' })), { status: 200 }))
    await screen.findByText('Cancelaste tu turno')
  })
})
