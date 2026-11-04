import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // generated audio and downloaded passage data are not source files
  server: { watch: { ignored: ['**/infra/**', '**/public/sa/**', '**/ref/**'] } },
})
