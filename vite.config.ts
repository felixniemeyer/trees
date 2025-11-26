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
      'shaders': path.resolve(__dirname, 'src/shaders')
    }
  },
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
