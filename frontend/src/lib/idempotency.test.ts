import { describe, expect, it } from 'vitest'
import { generateIdempotencyKey } from './idempotency'

// Cubre: formato/largo; dos llamadas -> distintas.
// El backend exige Idempotency-Key de 8 a 100 caracteres (routers/public.py).

describe('lib/idempotency', () => {
  it('genera una clave hexadecimal de 64 caracteres (32 bytes)', () => {
    const key = generateIdempotencyKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('el largo cumple con lo que exige el backend (8-100 caracteres)', () => {
    const key = generateIdempotencyKey()
    expect(key.length).toBeGreaterThanOrEqual(8)
    expect(key.length).toBeLessThanOrEqual(100)
  })

  it('dos llamadas generan claves distintas', () => {
    const a = generateIdempotencyKey()
    const b = generateIdempotencyKey()
    expect(a).not.toBe(b)
  })
})
