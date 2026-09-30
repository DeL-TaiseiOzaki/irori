import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { documentation } from './docs/build';
const docs = documentation(fileURLToPath(new URL('.', import.meta.url)));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [docs.plugin],
  build: {
    outDir: '../dist-website',
    emptyOutDir: true,
    rollupOptions: {
      input: [fileURLToPath(new URL('./index.html', import.meta.url)), ...docs.inputs],
    },
  },
});
