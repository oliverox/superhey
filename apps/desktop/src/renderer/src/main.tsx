import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyStoredLook } from './theme'
import { installShortcuts } from './shortcuts'

// Apply before first paint so the window never flashes the wrong theme.
applyStoredLook()
installShortcuts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
