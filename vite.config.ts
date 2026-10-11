import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url))
    }
  },
  build: {
    target: "es2022"
  },
  server: {
    headers: {
      "Service-Worker-Allowed": "/"
    }
  }
});
