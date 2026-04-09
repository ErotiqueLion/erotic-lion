import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // kuromoji が使う Node.js 組み込みモジュール（zlib, path 等）をブラウザ用にポリフィル
    nodePolyfills({ include: ['path', 'zlib', 'buffer', 'stream', 'util', 'events'] }),
  ],
  base: '/erotic-lion/games/erotic-word-chain-kai/',
})
