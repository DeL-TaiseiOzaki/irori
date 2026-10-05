# Routines icon generation

Generated on 2026-10-05 with the built-in GPT Image tool. The existing Home
and irori mode PNGs were supplied as style references. The full generated RGBA
image is preserved in `irori-routines-icon.png`; `irori-routines-icon-256.png`
is a resampled renderer derivative. The rail clips the tile's outer silhouette
to a smooth rounded square at its 40px display size.

## Generation prompt

```text
Use case: logo-brand
Asset type: finished raster app navigation icon for irori's Routines button, displayed at 40 x 40 CSS pixels.
Input images: Image 1 is the existing irori Home icon, style reference only. Image 2 is the existing irori mode icon, style reference only. Create one NEW matching sibling icon; do not modify either reference.
Primary request: a recognizable recurring-routine symbol in the same sculpted folded-paper visual family. A simple circular cycle made of two broad charcoal folded ribbons, with two clear integrated arrow tips, encloses one small warm orange ember flame. Let the folds, restrained soft shading, rounded tile shape and centered orange flame match the supplied irori icon family.
Scene/backdrop: clean off-white rounded-square ceramic-like app tile, rounded corners and thin soft edge exactly like reference image 2; genuinely transparent pixels outside the rounded tile.
Composition/framing: square, one centered icon, tile fills about 88 percent of canvas, generous padding around the internal mark, circular arrows and central flame readable at 40 pixels. Frontal view with subtle dimensional folds, no perspective tilt.
Color palette: graphite charcoal, warm off-white, a single orange-to-gold flame matching the references. No extra hues.
Materials/textures: smooth matte sculpted paper, simple broad folded surfaces, gentle realistic studio shading like the references.
Text: none.
Constraints: one icon only, no grid or variants, no people, no gears, no clocks, no letters, no watermark, no decorative sparks, no checkerboard background. Keep the same level of polish and visual weight as the reference icons. Preserve actual transparent alpha outside the tile.
```

## Finishing prompt

```text
Use case: background-extraction / precise-object-edit
Image 1 is the icon edit target. Image 2 is the irori mode style and silhouette reference.
Change ONLY the tile's outer edge and transparent surround of image 1. Preserve the two sculpted charcoal circular arrows, central orange folded flame, existing soft lighting, internal shading and composition exactly.
The current tile has ragged white speckles and wisps outside its outline. Remove every speckle and wisp. Make one perfectly smooth, crisp antialiased rounded-square silhouette exactly like reference image 2, with equal radii on all four corners, straight horizontal/vertical middle edges, and clean genuine transparent alpha everywhere outside that silhouette. The tile occupies 88% of a square canvas, is centered with consistent margins. The ivory tile may have a very fine uniform graphite boundary just like image 2. No external drop shadow. No noise or texture in the transparent area, no checkerboard. Output the single finished icon, no text or variants.
```
