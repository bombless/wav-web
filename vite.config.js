import { defineConfig } from 'vite'

export default defineConfig({
  // Use relative asset URLs so the app works on GitHub Pages under /wav-web/
  // as well as when deployed at a custom domain/root path.
  base: './'
})
