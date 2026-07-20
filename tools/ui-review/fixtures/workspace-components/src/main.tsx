import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { readUiReviewComponentFixture, UiReviewComponentFixture } from "./fixtures"
import "./styles.css"

const fixture = readUiReviewComponentFixture() ?? "file-tree"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiReviewComponentFixture name={fixture} />
  </StrictMode>,
)
