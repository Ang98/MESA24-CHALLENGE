import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Limpieza entre tests: desmonta componentes (para que se disparen los
// cleanup de useEffect, p. ej. clearInterval de usePolling), restaura fetch
// y mocks, y borra localStorage para que un test no contamine al siguiente.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  window.localStorage.clear()
})
