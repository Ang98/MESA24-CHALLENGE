import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabletPage, minutesWaiting } from './TabletPage'
import { installFetchMock, type MockRoute } from '../testSupport/mockFetch'
import type { TabletQueueItem } from '../api/types'

// Pantalla de la tablet del anfitrion (NOTA_TECNICA.md, seccion 2): sondeo
// cada 4s, minutos esperando calculados con el reloj del servidor (nunca el
// de la tablet), y sin conexion desactiva las acciones sin perder la lista.

const TOKEN = 'tablet-token-xyz'
const TOKEN_KEY = 'mesa247:tablet-token'

function item(overrides: Partial<TabletQueueItem> & { id: number; status: TabletQueueItem['status'] }): TabletQueueItem {
  const defaults = {
    name: 'Ana Torres',
    party_size: 2,
    joined_at: '2026-01-01T12:00:00Z',
    phone_last3: '321',
    on_my_way: false,
  }
  return {
    ...defaults,
    ...overrides,
  }
}

function queueRoute(responses: MockRoute['responses']): MockRoute {
  return { method: 'GET', match: /^\/api\/tablet\/queue$/, responses }
}

function queueBody(entries: TabletQueueItem[], serverTime = '2026-01-01T12:00:00Z') {
  return { location: { slug: 'demo-lima', name: 'Demo Lima' }, server_time: serverTime, entries }
}

function setStoredToken(): void {
  window.localStorage.setItem(TOKEN_KEY, TOKEN)
}

describe('TabletPage: minutesWaiting (funcion pura)', () => {
  it('redondea hacia abajo: 59s siguen siendo 0 min', () => {
    expect(minutesWaiting('2026-01-01T12:00:59Z', '2026-01-01T12:00:00Z')).toBe(0)
  })

  it('redondea hacia abajo: 90s son 1 min, no 2', () => {
    expect(minutesWaiting('2026-01-01T12:01:30Z', '2026-01-01T12:00:00Z')).toBe(1)
  })
})

describe('TabletPage: token', () => {
  it('sin token guardado muestra el formulario para pegarlo', () => {
    render(<TabletPage />)
    expect(screen.getByText('Ingresar a la tablet')).toBeInTheDocument()
    expect(screen.getByLabelText('Token de la tablet')).toBeInTheDocument()
  })

  it('un 401 borra el token y vuelve al formulario con el aviso', async () => {
    setStoredToken()
    installFetchMock([queueRoute([{ status: 401, body: { detail: { code: 'unauthorized' } } }])])
    render(<TabletPage />)

    await screen.findByText('El token no es válido o fue revocado')
    expect(screen.getByLabelText('Token de la tablet')).toBeInTheDocument()
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull()
  })

  it('al guardar el token se pide la cola de inmediato, sin esperar el intervalo de 4s', async () => {
    installFetchMock([queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }])])
    const user = userEvent.setup()
    render(<TabletPage />)

    await user.type(screen.getByLabelText('Token de la tablet'), TOKEN)
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    // sin fake timers de por medio: si la app esperara el tick de 4s, esto no aparecería a tiempo.
    await screen.findByText('Ana Torres')
  })

  it('una respuesta atrasada pedida con el token anterior no se muestra tras cambiar de token', async () => {
    setStoredToken()
    let getCallCount = 0
    let resolveFirst: ((res: Response) => void) | undefined
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/tablet/queue') {
        getCallCount += 1
        if (getCallCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve
          })
        }
        return Promise.resolve(
          new Response(JSON.stringify(queueBody([item({ id: 2, status: 'waiting', name: 'Beto Ruiz' })])), {
            status: 200,
          }),
        )
      }
      return Promise.reject(new Error(`ruta no mockeada: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const user = userEvent.setup()
    render(<TabletPage />)
    await waitFor(() => expect(getCallCount).toBe(1))

    await user.click(screen.getByRole('button', { name: 'Cambiar token' }))
    await user.type(await screen.findByLabelText('Token de la tablet'), 'tablet-token-b')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    await screen.findByText('Beto Ruiz')

    // se resuelve, atrasada, la peticion hecha con el token anterior
    resolveFirst?.(
      new Response(JSON.stringify(queueBody([item({ id: 1, status: 'waiting', name: 'Ana Torres' })])), {
        status: 200,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByText('Ana Torres')).not.toBeInTheDocument()
    expect(screen.getByText('Beto Ruiz')).toBeInTheDocument()
  })
})

describe('TabletPage: fila de la cola', () => {
  it('botones exactos por estado: waiting = Llamar/Sentar/Quitar/Recuperar turno', async () => {
    setStoredToken()
    installFetchMock([queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }])])
    render(<TabletPage />)

    const row = (await screen.findAllByRole('listitem'))[0]
    const buttons = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons).toEqual(['Llamar', 'Sentar', 'Quitar', 'Recuperar turno'])
  })

  it('botones exactos por estado: called = Sentar/No vino/Recuperar turno', async () => {
    setStoredToken()
    installFetchMock([queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'called' })]) }])])
    render(<TabletPage />)

    const row = (await screen.findAllByRole('listitem'))[0]
    const buttons = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons).toEqual(['Sentar', 'No vino', 'Recuperar turno'])
  })

  it('calcula los minutos esperando a partir de server_time (no del reloj local)', async () => {
    setStoredToken()
    installFetchMock([
      queueRoute([
        {
          status: 200,
          body: queueBody(
            [item({ id: 1, status: 'waiting', joined_at: '2026-01-01T12:00:00Z' })],
            '2026-01-01T12:10:00Z',
          ),
        },
      ]),
    ])
    render(<TabletPage />)

    await screen.findByText('10 min')
  })

  it('muestra la etiqueta "En camino" solo si on_my_way es true', async () => {
    setStoredToken()
    installFetchMock([
      queueRoute([
        {
          status: 200,
          body: queueBody([
            item({ id: 1, status: 'called', on_my_way: true }),
            item({ id: 2, status: 'waiting', on_my_way: false, name: 'Beto Ruiz' }),
          ]),
        },
      ]),
    ])
    render(<TabletPage />)

    const rows = await screen.findAllByRole('listitem')
    expect(within(rows[0]).getByText('En camino')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('En camino')).not.toBeInTheDocument()
  })

  it('muestra solo los ultimos 3 digitos del telefono', async () => {
    setStoredToken()
    installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting', phone_last3: '789' })]) }]),
    ])
    render(<TabletPage />)

    await screen.findByText('···789')
  })
})

describe('TabletPage: sin conexion', () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
  })

  it('navigator.onLine en false muestra el banner y desactiva todos los botones de accion', async () => {
    setStoredToken()
    installFetchMock([queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }])])
    render(<TabletPage />)

    await screen.findByText('Ana Torres')

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))

    await screen.findByText(/Sin conexión · última actualización/)
    for (const name of ['Llamar', 'Sentar', 'Quitar', 'Recuperar turno']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })

  it('un error de red durante el sondeo (con onLine=true) tambien muestra el banner y desactiva los botones', async () => {
    setStoredToken()
    installFetchMock([
      queueRoute([
        { status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) },
        { status: 0, body: undefined },
      ]),
    ])
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    expect(window.navigator.onLine).toBe(true)

    document.dispatchEvent(new Event('visibilitychange'))

    await screen.findByText(/Sin conexión · última actualización/)
    for (const name of ['Llamar', 'Sentar', 'Quitar', 'Recuperar turno']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })
})

describe('TabletPage: acciones', () => {
  it('409 muestra el aviso y refresca la cola (un GET nuevo despues de la accion)', async () => {
    const { calls } = installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/call$/,
        responses: [{ status: 409, body: { detail: { code: 'invalid_transition', current_status: 'called' } } }],
      },
    ])
    setStoredToken()
    const user = userEvent.setup()
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    expect(calls.filter((c) => c.method === 'GET').length).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Llamar' }))

    await screen.findByText('Otra tablet ya cambió este turno')
    expect(calls.filter((c) => c.method === 'GET').length).toBe(2)
  })

  it('Recuperar turno pide el enlace, desactiva los botones de la fila mientras esta en curso y lo muestra en el dialogo', async () => {
    setStoredToken()
    const { calls } = installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/recover-link$/,
        responses: [{ status: 200, body: { url: 'http://localhost:5173/t/tok-abc' }, defer: true }],
      },
    ])
    const user = userEvent.setup()
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    await user.click(screen.getByRole('button', { name: 'Recuperar turno' }))

    // mientras la peticion sigue pendiente, toda la fila queda desactivada
    expect(screen.getByRole('button', { name: 'Llamar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Sentar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Recuperar turno' })).toBeDisabled()

    const recoverCall = calls.find((c) => c.method === 'POST')
    recoverCall?.resolve?.({ status: 200, body: { url: 'http://localhost:5173/t/tok-abc' } })

    const input = await screen.findByLabelText('Enlace del turno')
    expect(input).toHaveValue('http://localhost:5173/t/tok-abc')
  })

  it('un error de red al recuperar el enlace muestra el aviso de reintentar', async () => {
    setStoredToken()
    installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/recover-link$/,
        responses: [{ status: 0, body: undefined }],
      },
    ])
    const user = userEvent.setup()
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    await user.click(screen.getByRole('button', { name: 'Recuperar turno' }))

    await screen.findByText('No se pudo obtener el enlace. Vuelve a intentarlo.')
  })

  it('un 401 al recuperar el enlace vuelve al formulario del token', async () => {
    setStoredToken()
    installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/recover-link$/,
        responses: [{ status: 401, body: { detail: { code: 'unauthorized' } } }],
      },
    ])
    const user = userEvent.setup()
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    await user.click(screen.getByRole('button', { name: 'Recuperar turno' }))

    await screen.findByText('El token no es válido o fue revocado')
    expect(screen.getByLabelText('Token de la tablet')).toBeInTheDocument()
  })
})

// Una accion (Recuperar turno, Llamar, etc.) sigue en vuelo mientras un tick
// de sondeo (visibilitychange, el intervalo de 4s) hace su propio GET de la
// cola. Esto solia romper: `refreshFor` y las acciones compartian el mismo
// contador (`requestIdRef`), asi que el GET del sondeo lo adelantaba y, al
// resolver la accion, la comprobacion de "sigo siendo el mas nuevo" fallaba
// y el resultado se descartaba (el dialogo de Recuperar turno no se abria,
// o no aparecia el aviso de 409). Ahora las acciones solo miran
// `tokenEpochRef` (que solo cambia al guardar/cambiar el token de la
// tablet), asi que un GET de sondeo intermedio no las afecta.
describe('TabletPage: una accion en vuelo no se ve afectada por un tick de sondeo', () => {
  it('Recuperar turno: un tick de sondeo mientras el POST sigue pendiente no impide que aparezca el dialogo', async () => {
    setStoredToken()
    const { calls } = installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/recover-link$/,
        responses: [{ status: 200, body: { url: 'http://localhost:5173/t/tok-abc' }, defer: true }],
      },
    ])
    const user = userEvent.setup()
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    await user.click(screen.getByRole('button', { name: 'Recuperar turno' }))

    // tick de sondeo intermedio: su GET se resuelve con normalidad
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBe(2))

    // recien ahora resuelve el POST, que empezo antes que ese GET
    const recoverCall = calls.find((c) => c.method === 'POST')
    recoverCall?.resolve?.({ status: 200, body: { url: 'http://localhost:5173/t/tok-abc' } })

    const input = await screen.findByLabelText('Enlace del turno')
    expect(input).toHaveValue('http://localhost:5173/t/tok-abc')
  })

  it('Llamar: un 409 que llega despues de un tick de sondeo igual muestra el aviso', async () => {
    setStoredToken()
    const { calls } = installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/call$/,
        responses: [
          { status: 409, body: { detail: { code: 'invalid_transition', current_status: 'called' } }, defer: true },
        ],
      },
    ])
    const user = userEvent.setup()
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    await user.click(screen.getByRole('button', { name: 'Llamar' }))

    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBe(2))

    const callCall = calls.find((c) => c.method === 'POST')
    callCall?.resolve?.({ status: 409, body: { detail: { code: 'invalid_transition', current_status: 'called' } } })

    await screen.findByText('Otra tablet ya cambió este turno')
  })

  it('dos filas con acciones diferidas a la vez: la segunda sigue desactivada hasta resolverse la suya', async () => {
    setStoredToken()
    const { calls } = installFetchMock([
      queueRoute([
        {
          status: 200,
          body: queueBody([
            item({ id: 1, status: 'waiting', name: 'Ana Torres' }),
            item({ id: 2, status: 'waiting', name: 'Beto Ruiz' }),
          ]),
        },
      ]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/call$/,
        responses: [{ status: 200, body: item({ id: 1, status: 'waiting', name: 'Ana Torres' }), defer: true }],
      },
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/2\/call$/,
        responses: [{ status: 200, body: item({ id: 2, status: 'waiting', name: 'Beto Ruiz' }), defer: true }],
      },
    ])
    const user = userEvent.setup()
    render(<TabletPage />)

    const rows = await screen.findAllByRole('listitem')
    await user.click(within(rows[0]).getByRole('button', { name: 'Llamar' }))
    await user.click(within(rows[1]).getByRole('button', { name: 'Llamar' }))

    expect(within(rows[0]).getByRole('button', { name: 'Llamar' })).toBeDisabled()
    expect(within(rows[1]).getByRole('button', { name: 'Llamar' })).toBeDisabled()

    const call1 = calls.find((c) => c.method === 'POST' && c.url === '/api/tablet/entries/1/call')
    const call2 = calls.find((c) => c.method === 'POST' && c.url === '/api/tablet/entries/2/call')

    call1?.resolve?.({ status: 200, body: item({ id: 1, status: 'waiting', name: 'Ana Torres' }) })
    await waitFor(() => expect(within(rows[0]).getByRole('button', { name: 'Llamar' })).not.toBeDisabled())
    expect(within(rows[1]).getByRole('button', { name: 'Llamar' })).toBeDisabled()

    call2?.resolve?.({ status: 200, body: item({ id: 2, status: 'waiting', name: 'Beto Ruiz' }) })
    await waitFor(() => expect(within(rows[1]).getByRole('button', { name: 'Llamar' })).not.toBeDisabled())
  })

  it('si se cambia de token mientras Recuperar turno esta en vuelo, al resolverse no aparece el dialogo', async () => {
    setStoredToken()
    const { calls } = installFetchMock([
      queueRoute([{ status: 200, body: queueBody([item({ id: 1, status: 'waiting' })]) }]),
      {
        method: 'POST',
        match: /^\/api\/tablet\/entries\/1\/recover-link$/,
        responses: [{ status: 200, body: { url: 'http://localhost:5173/t/tok-abc' }, defer: true }],
      },
    ])
    const user = userEvent.setup()
    render(<TabletPage />)

    await screen.findByText('Ana Torres')
    await user.click(screen.getByRole('button', { name: 'Recuperar turno' }))

    await user.click(screen.getByRole('button', { name: 'Cambiar token' }))
    await screen.findByLabelText('Token de la tablet')

    const recoverCall = calls.find((c) => c.method === 'POST')
    recoverCall?.resolve?.({ status: 200, body: { url: 'http://localhost:5173/t/tok-abc' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.queryByLabelText('Enlace del turno')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Token de la tablet')).toBeInTheDocument()
  })
})
