import '@fontsource-variable/inter'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/newsreader'
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
// The Mac draws its window buttons over the top-left corner (styles.css makes room for them).
if (/Mac/.test(navigator.platform)) document.documentElement.dataset.mac = ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
