import { createRoot } from 'react-dom/client'

import '@hachej/boring-agent/front/styles.css'
import './app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
