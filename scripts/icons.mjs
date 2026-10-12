/**
 * Render the Detour Proxy SVG logo to the raster PNG icons Chromium needs.
 *
 * Chromium's toolbar action icon and the store `icons` field require bitmaps
 * (SVG is not supported there), so this script rasterizes
 * `branding/detour-icon.svg` to `branding/icons/icon-{16,32,48,128}.png` using
 * sharp. `scripts/package.mjs` then copies those PNGs into `extension/icons/`
 * and the manifest references them.
 *
 * Run via `npm run icons` (also invoked by `npm run package`).
 */
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcSvg = join(root, 'branding', 'detour-icon.svg');
const outDir = join(root, 'branding', 'icons');

const SIZES = [16, 32, 48, 128];

const svg = await readFile(srcSvg);
await mkdir(outDir, { recursive: true });

for (const size of SIZES) {
  // Rasterize the SVG at a high density first, then resize down so small icons
  // stay crisp (downscaling a clean large raster beats rendering tiny directly).
  const png = await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await writeFile(join(outDir, `icon-${size}.png`), png);
  console.log(`icons: wrote icon-${size}.png`);
}

console.log(`Detour Proxy icons written to ${outDir}`);
