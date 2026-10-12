/**
 * Build the store-upload ZIP for Detour Proxy.
 *
 * The Chrome Web Store / Edge Add-ons expect an UNSIGNED zip whose
 * `manifest.json` sits at the archive ROOT (not nested under a folder). This
 * zips the CONTENTS of `extension/` (produced by `npm run package`) so the
 * manifest lands at the top level, and names the file from the manifest
 * version: `dist-zip/detour-proxy-<version>.zip`.
 *
 * Run via `npm run zip` (which runs `npm run package` first).
 */
import AdmZip from 'adm-zip';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'extension');
const manifestPath = join(extDir, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('Missing extension/manifest.json. Run "npm run package" first.');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const version = manifest.version;
if (typeof version !== 'string' || version.length === 0) {
  console.error('manifest.json has no valid "version".');
  process.exit(1);
}

const outDir = join(root, 'dist-zip');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, `detour-proxy-${version}.zip`);

const zip = new AdmZip();
// addLocalFolder places the folder's CONTENTS at the archive root, so
// manifest.json ends up at the top level (required by the stores).
zip.addLocalFolder(extDir);
zip.writeZip(outPath);

// Verify the manifest is at the root of the produced archive.
const entries = new AdmZip(outPath).getEntries().map((e) => e.entryName);
if (!entries.includes('manifest.json')) {
  console.error('ZIP verification failed: manifest.json is not at the archive root.');
  process.exit(1);
}

console.log(`Store zip written: ${outPath}`);
console.log(`  ${entries.length} entries, manifest.json at root: OK`);
console.log(`  Upload this file to the Chrome Web Store / Edge Add-ons dashboard.`);
