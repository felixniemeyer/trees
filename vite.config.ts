import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import path from 'path'

console.log("dirname:", __dirname); 

export default defineConfig({
  plugins: [glsl({
    include: [
      '**/*.glsl',
      '**/*.vert',
      '**/*.frag',
      '**/*.vs',
      '**/*.fs'
    ],
    root: path.resolve(__dirname, 'src'), 
  })],
  resolve: {
    alias: {
      'utils': path.resolve(__dirname, 'src/utils'),
      'shaders': path.resolve(__dirname, 'src/shaders'),
      'time-n-controls': path.resolve(__dirname, 'node_modules/time-n-controls/src/lib.ts')
    }
  },
  server: {
    watch: {
      // Watch npm linked packages
      ignored: ['!**/node_modules/web-mapper/**', '!**/node_modules/time-n-controls/**']
    }
  },
  optimizeDeps: {
    // Don't pre-bundle npm linked packages so HMR works
    exclude: ['web-mapper', 'time-n-controls']
  }
})
