import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "@boring/workspace/globals.css"
import "./app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
