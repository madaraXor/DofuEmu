import { defineConfig } from 'vite'
import path from 'path'

const isExternalDependency = (id: string) =>
  id === 'electron' ||
  id.startsWith('electron/') ||
  (!id.startsWith('.') && !path.isAbsolute(id) && !id.startsWith('@dofemu/'))

export default defineConfig({
  build: {
    outDir: path.resolve(__dirname, '../../dist/preload'),
    lib: {
      entry: path.resolve(__dirname, 'index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs'
    },
    rollupOptions: {
      external: isExternalDependency
    },
    minify: false,
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@dofemu/shared': path.resolve(__dirname, '../shared/index.ts')
    }
  }
})
