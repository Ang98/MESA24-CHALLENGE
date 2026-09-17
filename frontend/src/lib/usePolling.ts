import { useEffect, useRef } from 'react'

/** Comensal: cada 15 s (nota tecnica: escala de polling). */
export const TURN_POLL_INTERVAL_MS = 15_000
/** Tablet: cada 4 s. */
export const TABLET_POLL_INTERVAL_MS = 4_000

/**
 * Ejecuta `callback` de inmediato, luego cada `intervalMs`, y tambien al
 * volver a la pestaña (visibilitychange -> visible).
 *
 * Si `callback` sigue en curso (su promesa no resolvio) cuando toca el
 * siguiente tick, ese tick se salta: evita pedidos superpuestos cuando la
 * red esta lenta (p. ej. wifi que no responde).
 */
export function usePolling(callback: () => void | Promise<void>, intervalMs: number): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const runningRef = useRef(false)

  useEffect(() => {
    async function tick(): Promise<void> {
      if (runningRef.current) return
      runningRef.current = true
      try {
        await callbackRef.current()
      } finally {
        runningRef.current = false
      }
    }

    void tick()

    const id = window.setInterval(() => {
      void tick()
    }, intervalMs)

    function handleVisibility(): void {
      if (document.visibilityState === 'visible') {
        void tick()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [intervalMs])
}
