import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'
import ErroTela from './components/ErroTela'
import { AuthProvider } from './auth/AuthContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErroTela>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErroTela>
  </React.StrictMode>,
)

// App instalável (PWA): registra o service worker só na versão publicada
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
