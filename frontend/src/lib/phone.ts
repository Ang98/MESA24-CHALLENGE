/** Paises, armado de E.164 y validacion de telefono (comensal). */

export type CountryCode = 'PE' | 'CL' | 'OTHER'

export interface Country {
  code: CountryCode
  label: string
  dialCode: string
}

export const COUNTRIES: Country[] = [
  { code: 'PE', label: 'Perú (+51)', dialCode: '+51' },
  { code: 'CL', label: 'Chile (+56)', dialCode: '+56' },
  { code: 'OTHER', label: 'Otro país', dialCode: '' },
]

// Mismo formato que backend/app/phones.py (normalize_phone).
const OTHER_PHONE_RE = /^\+[1-9]\d{7,14}$/
const STRIP_CHARS_RE = /[\s\-.()]+/g

export const PE_CL_PHONE_ERROR = 'Ingresa un celular de 9 dígitos que empiece con 9'
export const OTHER_PHONE_ERROR = 'Ingresa el número completo con código de país, por ejemplo +34 612 345 678'
export const OTHER_COUNTRY_NOTICE =
  'A números fuera de Perú y Chile no les llega SMS. Podrás unirte igual: mantén abierta la pantalla de tu turno.'

export function stripPhoneChars(raw: string): string {
  return raw.replace(STRIP_CHARS_RE, '')
}

/** Perú/Chile: exactamente 9 digitos y empieza con 9 (espacios/guiones se ignoran). */
export function isValidNationalDigits(raw: string): boolean {
  return /^9\d{8}$/.test(stripPhoneChars(raw))
}

/** Otro pais: numero completo con codigo, igual regla que el backend. */
export function isValidOtherPhone(raw: string): boolean {
  return OTHER_PHONE_RE.test(stripPhoneChars(raw))
}

function dialCodeFor(country: CountryCode): string {
  const found = COUNTRIES.find((c) => c.code === country)
  return found ? found.dialCode : ''
}

/** Arma el E.164 a partir del pais elegido y lo que escribio el usuario. */
export function buildE164(country: CountryCode, rawInput: string): string {
  if (country === 'OTHER') {
    return stripPhoneChars(rawInput)
  }
  return `${dialCodeFor(country)}${stripPhoneChars(rawInput)}`
}

export interface PhoneValidation {
  valid: boolean
  error?: string
}

export function validatePhone(country: CountryCode, rawInput: string): PhoneValidation {
  if (country === 'OTHER') {
    if (isValidOtherPhone(rawInput)) return { valid: true }
    return { valid: false, error: OTHER_PHONE_ERROR }
  }
  if (isValidNationalDigits(rawInput)) return { valid: true }
  return { valid: false, error: PE_CL_PHONE_ERROR }
}
