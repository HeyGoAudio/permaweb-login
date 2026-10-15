import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    basicSsl(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    })
  ],
  resolve: {
    alias: {
      'ardb/lib/models/transaction': path.resolve(__dirname, './vendor/ardb/src/models/transaction.ts'),
      'ardb/lib/models/block': path.resolve(__dirname, './vendor/ardb/src/models/block.ts'),
      'ardb': path.resolve(__dirname, './vendor/ardb/src/ardb.ts'),
      'arweave-account': path.resolve(__dirname, './vendor/arweave-account/src/index.ts'),
      'blockweave': path.resolve(__dirname, './src/utils/blockweave-stub.js'),
    }
  },
  server: {
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
})
