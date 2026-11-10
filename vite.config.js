import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    root: 'ui',
    plugins: [react()],
    server: {
        proxy: {
            '/api': `http://localhost:${process.env.PORT || 3001}`
        }
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true
    }
})
