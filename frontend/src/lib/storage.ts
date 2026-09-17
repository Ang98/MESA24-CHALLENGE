/**
 * localStorage con try/catch: si falla (modo privado, cuota, etc.) la app
 * sigue funcionando, solo sin persistencia entre pantallas.
 */

const TURN_KEY_PREFIX = 'mesa247:turn:'
export const TABLET_TOKEN_KEY = 'mesa247:tablet-token'

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // localStorage no disponible: se sigue sin persistencia.
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // idem safeSet.
  }
}

export function turnKey(slug: string): string {
  return `${TURN_KEY_PREFIX}${slug}`
}

export function getTurnToken(slug: string): string | null {
  return safeGet(turnKey(slug))
}

export function setTurnToken(slug: string, token: string): void {
  safeSet(turnKey(slug), token)
}

export function clearTurnToken(slug: string): void {
  safeRemove(turnKey(slug))
}

/** Borra el turno guardado bajo cualquier slug cuyo valor sea ese token. */
export function clearTurnTokenIfMatches(token: string): void {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(TURN_KEY_PREFIX) && window.localStorage.getItem(key) === token) {
        window.localStorage.removeItem(key)
      }
    }
  } catch {
    // localStorage no disponible: nada que borrar.
  }
}

export function getTabletToken(): string | null {
  return safeGet(TABLET_TOKEN_KEY)
}

export function setTabletToken(token: string): void {
  safeSet(TABLET_TOKEN_KEY, token)
}

export function clearTabletToken(): void {
  safeRemove(TABLET_TOKEN_KEY)
}
