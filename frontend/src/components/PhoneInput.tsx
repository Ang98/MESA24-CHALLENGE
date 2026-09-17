import type { ChangeEvent } from 'react'
import { COUNTRIES, OTHER_COUNTRY_NOTICE, type CountryCode } from '../lib/phone'

interface PhoneInputProps {
  country: CountryCode
  rawValue: string
  onCountryChange: (country: CountryCode) => void
  onRawValueChange: (value: string) => void
  error?: string
}

export function PhoneInput({ country, rawValue, onCountryChange, onRawValueChange, error }: PhoneInputProps) {
  const isOther = country === 'OTHER'

  function handleCountryChange(event: ChangeEvent<HTMLSelectElement>): void {
    onCountryChange(event.target.value as CountryCode)
  }

  function handleValueChange(event: ChangeEvent<HTMLInputElement>): void {
    onRawValueChange(event.target.value)
  }

  return (
    <div className="phone-input">
      <span className="field-label">Teléfono</span>
      <div className="phone-input-row">
        <div className="phone-input-country">
          <label htmlFor="phone-country" className="field-label">
            País
          </label>
          <select id="phone-country" value={country} onChange={handleCountryChange}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="phone-input-number">
          <label htmlFor="phone-number" className="field-label">
            Celular
          </label>
          <input
            id="phone-number"
            type="tel"
            inputMode="tel"
            autoComplete={isOther ? 'tel' : 'tel-national'}
            placeholder={isOther ? '+34 612 345 678' : '9XXXXXXXX'}
            value={rawValue}
            onChange={handleValueChange}
            aria-invalid={error !== undefined}
          />
        </div>
      </div>

      {error ? <p className="field-error">{error}</p> : null}
      {isOther ? <p className="callout warn">{OTHER_COUNTRY_NOTICE}</p> : null}
    </div>
  )
}
