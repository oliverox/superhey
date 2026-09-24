import '@fontsource-variable/onest'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, storedTheme } from './theme'

// Apply before first paint so the window never flashes the wrong theme.
applyTheme(storedTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
