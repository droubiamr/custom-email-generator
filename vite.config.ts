import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// Vite builds the React app. The Cloudflare plugin also runs the Worker
// (worker/index.ts) locally during `npm run dev`, so the API, the database
// and the email handler all work on your machine without deploying.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
