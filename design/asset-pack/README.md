# The Leftovers — Kiro Website Asset Pack (Prototype Extraction)

This pack contains individual crops extracted from the generated visual asset board. It gives Kiro separate files to reference while building the first website pass.

## Style direction
- 1990s grunge / garage-rock / photocopied zine aesthetic
- Palette: near-black, charcoal, dirty cream, blood red, muted olive
- Texture: scratched paper, concrete, tape, film grain, weathered surfaces
- Typography direction: distressed brush lettering for the band name; compact bold condensed navigation labels

## Folders
- `logos/` — extracted raster logo concepts and star icon
- `photos/` — extracted hero and band-photo concepts
- `textures/` — extracted background texture tiles
- `elements/` — stars, brush strokes, tape/paper pieces, arrows and scribbles
- `ui/` — sample buttons, navigation texture and dividers
- `reference/` — full generated board for visual reference

## Important production note
These files are crops from a single 1536×1024 generated board, **not original full-resolution source images**. Some crops may retain tiny remnants of board layout, and the logo crops are not guaranteed to be perfectly clean transparent artwork. Treat them as prototype assets / visual direction, not finished print-ready or trademark-cleared masters. Before launch, replace the extracted logos with a carefully rebuilt SVG/transparent PNG and use full-size standalone hero photography.

## Suggested Kiro integration
Copy the folders into your site's `public/assets/leftovers/` directory. Use `photos/hero-desktop.jpg` as a temporary desktop hero, `textures/grunge-dark.jpg` as a subtle background layer, and `logos/logo-primary-extracted.png` for a first-pass brand mark. Keep texture opacity low behind text for readability. Use descriptive filenames and preserve this folder structure.

## Accessibility / implementation
- Use meaningful alt text for informative band images; use empty alt text for decorative textures and accents.
- Keep body text high-contrast against the dark background.
- Do not bake navigation labels into page screenshots; implement navigation as HTML.
- Optimize/compress these crops before production deployment.
