import { describe, expect, it } from 'vitest'
import { waitText } from './waitText'

// Cubre el rango de espera de la nota tecnica (seccion 2): [n*m, (n+1)*m] con
// n = grupos delante, m = minutos por grupo; n = 0 -> "Eres el siguiente".

describe('lib/waitText', () => {
  it('groups_ahead 0 muestra "Eres el siguiente · ~{b} min"', () => {
    expect(waitText(0, [12, 12])).toBe('Eres el siguiente · ~12 min')
  })

  it('groups_ahead 2 con [24,36] muestra "Entre 24 y 36 min"', () => {
    expect(waitText(2, [24, 36])).toBe('Entre 24 y 36 min')
  })
})
