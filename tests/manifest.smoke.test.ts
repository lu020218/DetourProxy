import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Manifest smoke / configuration test (Req 8.1, 8.5, 8.6).
 *
 * Reads the real manifest.json from the project root and asserts:
 * - manifest_version is exactly 3 and the manifest is structurally valid
 *   (name, version, background.service_worker, action.default_popup) (Req 8.1).
 * - permissions includes both "proxy" and "storage" (Req 8.5).
 * - permissions is EXACTLY ["proxy", "storage"] with no extras, and the
 *   manifest declares NO host_permissions or optional_permissions, satisfying
 *   the minimal-permission requirement (Req 8.6).
 */

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '..', 'manifest.json');

let manifest: Record<string, unknown>;

beforeAll(() => {
  const raw = readFileSync(manifestPath, 'utf-8');
  // Must be valid JSON; JSON.parse throws on malformed input.
  manifest = JSON.parse(raw) as Record<string, unknown>;
});

describe('manifest.json smoke/config (Req 8.1, 8.5, 8.6)', () => {
  it('has manifest_version exactly 3 (Req 8.1)', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('is structurally valid as a Manifest V3 extension (Req 8.1)', () => {
    // Required top-level identity fields.
    expect(typeof manifest.name).toBe('string');
    expect((manifest.name as string).length).toBeGreaterThan(0);
    expect(typeof manifest.version).toBe('string');
    expect((manifest.version as string).length).toBeGreaterThan(0);

    // MV3 background must be a service worker.
    const background = manifest.background as
      | { service_worker?: unknown }
      | undefined;
    expect(background).toBeTypeOf('object');
    expect(typeof background?.service_worker).toBe('string');
    expect((background?.service_worker as string).length).toBeGreaterThan(0);

    // Toolbar action with a popup page.
    const action = manifest.action as { default_popup?: unknown } | undefined;
    expect(action).toBeTypeOf('object');
    expect(typeof action?.default_popup).toBe('string');
    expect((action?.default_popup as string).length).toBeGreaterThan(0);
  });

  it('declares permissions including proxy and storage (Req 8.5)', () => {
    const permissions = manifest.permissions;
    expect(Array.isArray(permissions)).toBe(true);
    expect(permissions as string[]).toContain('proxy');
    expect(permissions as string[]).toContain('storage');
  });

  it('declares EXACTLY ["proxy", "storage"] with no extra permissions (Req 8.6)', () => {
    const permissions = manifest.permissions as string[];
    expect(Array.isArray(permissions)).toBe(true);
    // Order-independent exact match: exactly the two required permissions.
    expect([...permissions].sort()).toEqual(['proxy', 'storage']);
    expect(permissions).toHaveLength(2);
  });

  it('does not request any additional permission surfaces (Req 8.6)', () => {
    // Minimal permissions: no broad host access or optional permissions.
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('optional_permissions');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
  });
});
