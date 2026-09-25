import '@fontsource-variable/onest'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyScheme, applyTheme, storedScheme, storedTheme } from './theme'
import { installShortcuts } from './shortcuts'

// Apply before first paint so the window never flashes the wrong theme.
applyTheme(storedTheme())
applyScheme(storedScheme())
installShortcuts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
