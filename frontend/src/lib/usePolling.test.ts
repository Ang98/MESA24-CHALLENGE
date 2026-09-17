import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePolling } from './usePolling'

// El comensal y la tablet consultan su estado a intervalos fijos; si la red
// va lenta y una consulta todavia no responde, el siguiente tick no debe
// sumarle otra peticion en paralelo (usePolling.ts la salta).

describe('lib/usePolling', () => {
  it('ejecuta el callback de inmediato al montar y otra vez en cada intervalo', async () => {
    vi.useFakeTimers()
    const callback = vi.fn(async () => {})
    renderHook(() => usePolling(callback, 1000))

    expect(callback).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(3)
  })

  it('no lanza un tick nuevo si el anterior sigue en curso', async () => {
    vi.useFakeTimers()
    let resolveFirst: (() => void) | undefined
    const callback = vi.fn(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
    renderHook(() => usePolling(callback, 1000))

    // tick inmediato al montar; su promesa todavia no se resuelve
    expect(callback).toHaveBeenCalledTimes(1)

    // toca el intervalo, pero el primero sigue pendiente: se salta
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await vi.advanceTimersByTimeAsync(0)

    // ahora si, el siguiente intervalo dispara un tick nuevo
    await vi.advanceTimersByTimeAsync(1000)
    expect(callback).toHaveBeenCalledTimes(2)
  })
})
