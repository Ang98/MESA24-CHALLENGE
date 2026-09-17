/**
 * fetch nativo con manejo de errores del backend.
 *
 * Errores de dominio: {"detail": {"code": "...", "current_status": "..."}}
 * 422 de validacion de FastAPI: {"detail": [ {loc, msg, type}, ... ]}
 * Error de red (fetch lanza) o timeout: ApiError con status 0, code 'network'.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/** Si el backend no responde en este tiempo, se aborta y se trata como error de red. */
export const API_TIMEOUT_MS = 8_000

export class ApiError extends Error {
  status: number
  code: string
  currentStatus?: string
  retryAfter?: number

  constructor(params: { status: number; code: string; currentStatus?: string; retryAfter?: number }) {
    super(`ApiError(${params.status}, ${params.code})`)
    this.name = 'ApiError'
    this.status = params.status
    this.code = params.code
    this.currentStatus = params.currentStatus
    this.retryAfter = params.retryAfter
  }
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
}

function isDetailObject(value: unknown): value is { code?: string; current_status?: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

  // El timeout cubre toda la peticion, incluida la lectura del body: por eso
  // el clearTimeout va en un finally que envuelve tambien los response.json().
  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })
    } catch {
      // Error de red o timeout (abort) antes de recibir respuesta.
      throw new ApiError({ status: 0, code: 'network' })
    }

    if (response.ok) {
      try {
        return (await response.json()) as T
      } catch {
        // Abort mientras se leia el body (encabezados ya recibidos): mismo tratamiento.
        throw new ApiError({ status: 0, code: 'network' })
      }
    }

    const retryAfterHeader = response.headers.get('Retry-After')
    const retryAfter = retryAfterHeader !== null ? Number(retryAfterHeader) : undefined

    let code = 'unknown'
    let currentStatus: string | undefined

    try {
      const data: unknown = await response.json()
      if (data !== null && typeof data === 'object' && 'detail' in data) {
        const detail = (data as { detail: unknown }).detail
        if (Array.isArray(detail)) {
          // 422 de validacion de FastAPI: no trae "code", se normaliza a uno propio.
          code = 'validation_error'
        } else if (isDetailObject(detail)) {
          code = detail.code ?? 'unknown'
          currentStatus = detail.current_status
        }
      }
    } catch {
      if (controller.signal.aborted) {
        throw new ApiError({ status: 0, code: 'network' })
      }
      // Respuesta de error sin body JSON parseable: se deja code = 'unknown'.
    }

    throw new ApiError({ status: response.status, code, currentStatus, retryAfter })
  } finally {
    clearTimeout(timeoutId)
  }
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}
