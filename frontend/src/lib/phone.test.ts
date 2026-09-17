import { describe, expect, it } from 'vitest'
import {
  OTHER_PHONE_ERROR,
  PE_CL_PHONE_ERROR,
  buildE164,
  isValidNationalDigits,
  isValidOtherPhone,
  validatePhone,
} from './phone'

// Cubre: Peru/Chile con 9 digitos que empiezan con 9 (valido), 8 digitos, 10
// digitos, no empieza con 9 (invalidos), espacios/guiones ignorados; otro pais
// valido/invalido (mismo formato que backend/app/phones.py); E.164 armado.

describe('lib/phone: Peru/Chile (9 digitos, empieza con 9)', () => {
  it('acepta exactamente 9 digitos que empiezan con 9', () => {
    expect(isValidNationalDigits('987654321')).toBe(true)
  })

  it('rechaza 8 digitos', () => {
    expect(isValidNationalDigits('98765432')).toBe(false)
  })

  it('rechaza 10 digitos', () => {
    expect(isValidNationalDigits('9876543210')).toBe(false)
  })

  it('rechaza un numero que no empieza con 9', () => {
    expect(isValidNationalDigits('876543219')).toBe(false)
  })

  it('ignora espacios y guiones', () => {
    expect(isValidNationalDigits('987 654 321')).toBe(true)
    expect(isValidNationalDigits('987-654-321')).toBe(true)
    expect(isValidNationalDigits('9 8-7 6543-21')).toBe(true)
  })

  it('validatePhone devuelve el error de Peru/Chile cuando es invalido', () => {
    expect(validatePhone('PE', '123456789')).toEqual({ valid: false, error: PE_CL_PHONE_ERROR })
    expect(validatePhone('CL', '123456789')).toEqual({ valid: false, error: PE_CL_PHONE_ERROR })
  })

  it('validatePhone acepta un numero valido de Peru y de Chile', () => {
    expect(validatePhone('PE', '987654321')).toEqual({ valid: true })
    expect(validatePhone('CL', '912345678')).toEqual({ valid: true })
  })
})

describe('lib/phone: otro pais (+ codigo, 8 a 15 digitos)', () => {
  it('acepta un numero completo valido', () => {
    expect(isValidOtherPhone('+34612345678')).toBe(true)
    expect(validatePhone('OTHER', '+34612345678')).toEqual({ valid: true })
  })

  it('ignora espacios, guiones, puntos y parentesis', () => {
    expect(isValidOtherPhone('+34 612 345 678')).toBe(true)
    expect(isValidOtherPhone('+1 (305) 555-1234')).toBe(true)
  })

  it('rechaza un numero sin +', () => {
    expect(isValidOtherPhone('34612345678')).toBe(false)
  })

  it('rechaza un numero que empieza con 0 tras el +', () => {
    expect(isValidOtherPhone('+0123456789')).toBe(false)
  })

  it('rechaza un numero demasiado corto', () => {
    expect(isValidOtherPhone('+1234567')).toBe(false)
  })

  it('validatePhone devuelve el error de otro pais cuando es invalido', () => {
    expect(validatePhone('OTHER', '123')).toEqual({ valid: false, error: OTHER_PHONE_ERROR })
  })
})

describe('lib/phone: buildE164', () => {
  it('arma el E.164 de Peru anteponiendo +51', () => {
    expect(buildE164('PE', '987 654 321')).toBe('+51987654321')
  })

  it('arma el E.164 de Chile anteponiendo +56', () => {
    expect(buildE164('CL', '912-345-678')).toBe('+56912345678')
  })

  it('para otro pais deja el numero tal como lo escribio el usuario (limpio)', () => {
    expect(buildE164('OTHER', '+34 612 345 678')).toBe('+34612345678')
  })
})
