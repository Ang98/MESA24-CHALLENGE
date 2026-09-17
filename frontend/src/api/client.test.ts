import { describe, expect, it, vi } from 'vitest'
import { API_TIMEOUT_MS, ApiError, apiFetch } from './client'

// Si el backend nunca responde, apiFetch aborta con AbortController y lo
// trata igual que un error de red (no deja la pantalla colgada esperando).

describe('api/client: timeout', () => {
  it('aborta la peticion tras API_TIMEOUT_MS y responde con ApiError(status 0, code network)', async () => {
    vi.useFakeTimers()

    // fetch que nunca resuelve por si solo: solo reacciona si su AbortSignal se dispara.
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const pending = apiFetch('/api/locations/demo-lima')
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, code: 'network' })

    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)
    await assertion

    await pending.catch((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError)
    })
  })

  it('tambien aborta si la respuesta llega pero la lectura del body nunca resuelve', async () => {
    vi.useFakeTimers()

    // Encabezados 200 recibidos de inmediato, pero response.json() se queda
    // colgado: solo reacciona si se dispara el AbortSignal de la peticion.
    function fakeOkResponseThatHangsOnJson(signal?: AbortSignal) {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'))
            })
          }),
      }
    }
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      Promise.resolve(fakeOkResponseThatHangsOnJson(init?.signal) as unknown as Response),
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const pending = apiFetch('/api/locations/demo-lima')
    const assertion = expect(pending).rejects.toMatchObject({ status: 0, code: 'network' })

    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)
    await assertion
  })
})
