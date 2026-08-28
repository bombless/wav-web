import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Use relative asset URLs so the app works on GitHub Pages under /wav-web/
  // as well as when deployed at a custom domain/root path.
  base: './',
  resolve: {
    alias: {
      // Use the full Vue 2.7 build (with template compiler) so the in-DOM
      // template in index.html can be compiled at runtime.
      vue: fileURLToPath(new URL('./node_modules/vue/dist/vue.esm.js', import.meta.url))
    }
  }
})
