import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@boring/agent/front/styles.css'
import './app.css'

createRoot(document.getElementById('root')!).render(<App />)
