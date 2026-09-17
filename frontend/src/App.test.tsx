import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from './App'

// Test de humo: confirma que Vitest + jsdom + Testing Library + jest-dom +
// react-router quedan bien configurados.
describe('App', () => {
  it('muestra "Página no encontrada" para una ruta desconocida', () => {
    render(
      <MemoryRouter initialEntries={['/ruta-que-no-existe']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Página no encontrada')).toBeInTheDocument()
  })
})
