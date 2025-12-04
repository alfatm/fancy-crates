import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { builtinModules } from 'node:module'

// All Node.js built-in modules (with and without node: prefix)
const nodeBuiltins = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)]

export default defineConfig({
  build: {
    lib: {
      entry: {
        extension: resolve(__dirname, 'src/extension/index.ts'),
        cli: resolve(__dirname, 'src/cli/index.ts'),
        'examples/single-crate': resolve(__dirname, 'examples/single-crate.ts'),
        'examples/batch-analysis': resolve(__dirname, 'examples/batch-analysis.ts'),
        'examples/custom-registry': resolve(__dirname, 'examples/custom-registry.ts'),
        'examples/security-audit': resolve(__dirname, 'examples/security-audit.ts'),
      },
      formats: ['cjs'],
      fileName: (_, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: ['vscode', ...nodeBuiltins],
      output: {
        // Ensure each entry point gets its own complete bundle
        chunkFileNames: '[name].cjs',
      },
    },
    target: 'node16',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
  },
})
