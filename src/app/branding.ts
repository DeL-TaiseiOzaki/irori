export { version as appVersion } from '../../package.json';
// The renderer draws the mark at 40 and 80 CSS pixels. The full-resolution file
// stays for the window, the dock and the installers; bundling it would put
// 1.6 MB of pixels nobody displays into the first paint.
export const appIcon = new URL('../../assets/irori-icon-256.png', import.meta.url).href;
// irori mode's own mark, drawn at 40 CSS pixels on the rail.
export const iroriModeIcon = new URL('../../assets/irori-mode-icon-256.png', import.meta.url).href;
