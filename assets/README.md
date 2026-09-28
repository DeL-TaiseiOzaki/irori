# irori icon

`irori-icon.png` preserves the user's `output/imagegen/irori_icon-Photoroom.png` bytes (1254 × 1254, RGBA). Its transparent surround replaces the old baked-in checkerboard.

The app/website branding and favicons, Electron window/Dock and VM viewer share this PNG. `irori-icon.ico` (16–256px) and `irori-icon.icns` (up to 1024px) are standard platform encodings of the same image, generated with Pillow for Forge packaging. Windows also uses the ICO for its Squirrel setup executable. No artwork was regenerated.

# irori mode icon

`irori-mode-icon.png` (2048 × 2048, RGBA) is the rail mark for irori mode, made from the user's `irori-agent-mode.png` (1254 × 1254). The artwork was upscaled with Real-ESRGAN (`RealESRGAN_x4plus`), and its ragged background-removal edge was replaced: the tile takes `irori-icon.png`'s own silhouette and transparent surround, with the same top-lit falloff carried onto the white tile. `irori-mode-icon-256.png` is the size the renderer bundles.
