import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'

export default defineConfig({
  plugins: [glsl({
    include: [
      '**/*.glsl',
      '**/*.vert',
      '**/*.frag',
      '**/*.vs',
      '**/*.fs'
    ]
  })],
  server: {
    watch: {
      // Watch npm linked packages
      ignored: ['!**/node_modules/web-mapper/**']
    }
  },
  optimizeDeps: {
    // Don't pre-bundle npm linked packages so HMR works
    exclude: ['web-mapper']
  }
})
