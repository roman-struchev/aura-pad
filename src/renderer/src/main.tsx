import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/400-italic.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/jetbrains-mono/700-italic.css'
import './assets/main.css'
import './monaco-setup'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
