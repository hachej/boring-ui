import React from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"
import { PlaygroundApp } from "./App"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlaygroundApp />
  </React.StrictMode>,
)
