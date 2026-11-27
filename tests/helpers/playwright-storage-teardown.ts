import fs from 'node:fs';

/**
 * Shared Playwright globalTeardown removing the E2E storage root directory
 * once after all projects (desktop-1440, tablet-768, mobile-390) complete.
 */
export default async function playwrightStorageTeardown(): Promise<void> {
  const candidates = new Set(
    [
      process.env.LAWOFFICE_E2E_STORAGE_ROOT,
      process.env.T11_E2E_STORAGE_ROOT,
      process.env.T12_E2E_STORAGE_ROOT,
    ].filter((val): val is string => Boolean(val && val.trim()))
  );

  for (const storageRoot of candidates) {
    if (fs.existsSync(storageRoot)) {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  }
}
