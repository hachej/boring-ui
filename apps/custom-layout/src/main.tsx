import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Route } from "react-router-dom"
import { BoringApp } from "@boring/core/front"
import { CustomLayoutApp } from "./App"
import "@boring/workspace/globals.css"
import "./app.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BoringApp>
      <Route path="/workspace/:id" element={<CustomLayoutApp />} />
      <Route path="/*" element={<CustomLayoutApp />} />
    </BoringApp>
  </StrictMode>,
)
