import { defineConfig } from 'vite';
import { thirdPartyNotices } from './scripts/third-party-notices';
export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
  // pdf.js's CMaps and standard fonts, which the PDF viewer bundles (src/app/viewers/PdfView.tsx).
  assetsInclude: ['**/*.bcmap', '**/*.pfb', '**/*.wasm'],
  plugins: [thirdPartyNotices()],
});
