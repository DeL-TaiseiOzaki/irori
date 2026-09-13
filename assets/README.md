# irori icon

`irori-icon.png` is the user-selected icon supplied on 2026-09-13 as `output/imagegen/irori_icon.png` in the parent workspace. This repository copy preserves the supplied PNG bytes (1254 × 1254, RGB). The checkerboard surrounding the rounded black tile is part of the image, not an alpha channel.

The app's shared branding URL, app/favicon HTML, Electron window and macOS Dock configuration, website branding/favicon, and VM preview all use this asset. Vite copies it into the app/website bundles; the Electron host reads the repository's `assets/irori-icon.png`, so future desktop packaging must include this directory. Native Windows/macOS installer icons and platform acceptance remain part of the packaging backlog.
