import { defineConfig } from "vite";

// Only the splash lives here; the product UI is apps/web, served by the backend.
export default defineConfig({
  root: ".",
  server: { port: 5173, strictPort: true },
});
