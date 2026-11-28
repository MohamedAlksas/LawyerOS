import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared Playwright globalTeardown removing the E2E storage root directory
 * once after all projects (desktop-1440, tablet-768, mobile-390) complete.
 */
export default async function playwrightStorageTeardown(): Promise<void> {
  const storageRoot = process.env.LAWOFFICE_E2E_STORAGE_ROOT?.trim();
  if (!storageRoot) {
    return;
  }

  const tmpRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(storageRoot);
  const rel = path.relative(tmpRoot, resolved);
  const isInsideTmp =
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel);

  const base = path.basename(resolved);
  const hasAllowedPrefix = /^lawoffice-t\d+-e2e-/.test(base);

  if (!isInsideTmp || !hasAllowedPrefix) {
    return;
  }

  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
