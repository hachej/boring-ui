import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "app",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: false,
  },
});
