import { Route, Routes } from 'react-router-dom'
import { JoinPage } from './pages/JoinPage'
import { TurnPage } from './pages/TurnPage'
import { TabletPage } from './pages/TabletPage'

function NotFoundPage() {
  return <p>Página no encontrada</p>
}

export function App() {
  return (
    <Routes>
      <Route path="/l/:slug" element={<JoinPage />} />
      <Route path="/t/:token" element={<TurnPage />} />
      <Route path="/tablet" element={<TabletPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default App
