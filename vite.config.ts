import { defineConfig } from 'vite';
import { thirdPartyNotices } from './scripts/third-party-notices';
export default defineConfig({
  base: './',
  build: { outDir: 'dist' },
  plugins: [thirdPartyNotices()],
});
