/**
 * Render the Chrome Web Store promotional images from SVG to PNG.
 *
 * Store assets must be raster (PNG/JPEG). This rasterizes the branding SVGs to
 * the exact pixel sizes the store expects:
 *   - 440x280  — small promo tile
 *   - 1280x800 — marquee / screenshot
 *
 * Output goes to `branding/store/`. Run via `npm run promo`.
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandingDir = join(root, 'branding');
const outDir = join(brandingDir, 'store');

const ASSETS = [
  { svg: 'promo-440x280.svg', out: 'promo-440x280.png', w: 440, h: 280 },
  { svg: 'promo-1280x800.svg', out: 'promo-1280x800.png', w: 1280, h: 800 },
  { svg: 'promo-1400x560.svg', out: 'promo-1400x560.png', w: 1400, h: 560 },
];

await mkdir(outDir, { recursive: true });

for (const a of ASSETS) {
  const svg = await readFile(join(brandingDir, a.svg));
  // Render at ~2x density then resize to the exact target for crisp text/edges.
  const png = await sharp(svg, { density: 192 })
    .resize(a.w, a.h, { fit: 'fill' })
    .png()
    .toBuffer();
  await writeFile(join(outDir, a.out), png);
  console.log(`promo: wrote ${a.out} (${a.w}x${a.h})`);
}

console.log(`Store promo images written to ${outDir}`);
