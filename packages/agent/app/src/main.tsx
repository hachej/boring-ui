import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 600 }}>
      <h1>@boring/agent</h1>
      <p>Standalone dev server is running. Chat UI will appear here.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
