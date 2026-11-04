import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Served through the remote IDE's CloudFront proxy at a sub-path
// (/proxy/5173/) that the proxy STRIPS before forwarding to Vite, and it sends
// no X-Forwarded-Prefix. So:
//   - base: './'  -> emit asset URLs relative to the page, so the browser keeps
//                    requesting them under /proxy/5173/ (routes back to us),
//                    while Vite still serves them at root after the strip.
//   - host/allowedHosts -> reachable via the proxy and accept its Host header.
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // generated audio and downloaded passage data are not source files
    watch: { ignored: ['**/infra/**', '**/public/sa/**', '**/ref/**'] },
  },
})
