import { defineConfig } from "vite";

export default defineConfig({
  // listen on all interfaces so friends on the LAN can connect to the dev server
  server: { host: true, port: 5173 },
  preview: { host: true, port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // three.js changes rarely — keep it in its own long-cached chunk
        manualChunks: { three: ["three"] },
      },
    },
  },
});
