import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import './index.css'
import './assets/icon-font/icon-font.css'
import App from './App.jsx'

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  window.process = { env: {} };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
