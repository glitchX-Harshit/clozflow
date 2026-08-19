import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-three': ['three', '@react-three/fiber', '@react-three/drei'],
          'vendor-gsap': ['gsap'],
          'vendor-matter': ['matter-js'],
          'vendor-lucide': ['lucide-react']
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
})
