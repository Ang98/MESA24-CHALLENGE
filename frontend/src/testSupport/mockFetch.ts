/**
 * Utilidad SOLO para tests: instala un `fetch` falso que responde segun una
 * lista de rutas (method + regex sobre la URL). No es codigo de la app ni se
 * importa desde ella; existe para no repetir la logica de mockeo en cada
 * archivo `*.test.tsx` de paginas.
 *
 * `status: 0` en una respuesta simula un error de red (fetch que lanza), tal
 * como lo espera `api/client.ts`. `defer: true` deja la peticion sin resolver
 * hasta que el test llame a `call.resolve(...)`; sirve para reproducir
 * carreras (una respuesta que llega tarde, un token que cambio mientras
 * tanto, un boton que debe quedar deshabilitado mientras la peticion sigue
 * en curso).
 */
import { vi } from 'vitest'

export interface MockResponseSpec {
  status: number
  body?: unknown
  headers?: Record<string, string>
  defer?: boolean
}

export interface MockRoute {
  method: string
  match: RegExp
  responses: MockResponseSpec[]
}

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  /** Solo presente cuando la respuesta que le tocaba tenia `defer: true`. */
  resolve?: (spec: MockResponseSpec) => void
}

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string }

function toResponse(spec: MockResponseSpec): Response {
  return new Response(spec.body !== undefined ? JSON.stringify(spec.body) : null, {
    status: spec.status,
    headers: spec.headers,
  })
}

export function installFetchMock(routes: MockRoute[]): { calls: FetchCall[] } {
  const counters = new Map<MockRoute, number>()
  const calls: FetchCall[] = []

  const fetchMock = vi.fn((url: string, init?: FetchInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = init?.headers ?? {}
    const call: FetchCall = { url, method, headers, body: init?.body }
    calls.push(call)

    const route = routes.find((r) => r.method === method && r.match.test(url))
    if (!route) {
      return Promise.reject(new Error(`testSupport/mockFetch: sin ruta mockeada para ${method} ${url}`))
    }

    const idx = counters.get(route) ?? 0
    const spec = route.responses[Math.min(idx, route.responses.length - 1)]
    counters.set(route, idx + 1)

    if (spec.defer) {
      return new Promise<Response>((resolve, reject) => {
        call.resolve = (laterSpec: MockResponseSpec) => {
          if (laterSpec.status === 0) {
            reject(new TypeError('Failed to fetch (mock de red)'))
            return
          }
          resolve(toResponse(laterSpec))
        }
      })
    }

    if (spec.status === 0) {
      return Promise.reject(new TypeError('Failed to fetch (mock de red)'))
    }
    return Promise.resolve(toResponse(spec))
  })

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  return { calls }
}
