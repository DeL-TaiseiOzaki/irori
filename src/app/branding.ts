export { version as appVersion } from '../../package.json';
// The renderer draws the mark at 40 and 80 CSS pixels. The full-resolution file
// stays for the window, the dock and the installers; bundling it would put
// 1.6 MB of pixels nobody displays into the first paint.
export const appIcon = new URL('../../assets/irori-icon-256.png', import.meta.url).href;
