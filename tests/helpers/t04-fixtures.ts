import fs from 'fs';
import path from 'path';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { deleteT04Owner, seedT04Owner, signInWithTotp, type T04Owner } from './t04-auth';

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

interface T04WorkerFixtures {
  /**
   * One synthetic OWNER per Playwright worker, logged in once through the real
   * T03 UI. Storage is transferred as cookies into each runner-owned context so
   * Playwright still captures trace/screenshot/video on failure.
   */
  t04WorkerSession: { owner: T04Owner; storageState: StorageState };
}

interface T04TestFixtures {
  /** Fresh synthetic OWNER for tests that mutate session state. */
  t04Owner: T04Owner;
  /** Runner-owned page pre-authenticated with the worker session cookies. */
  t04Page: Page;
  /** Runner-owned page logged in as the fresh test-scoped owner. */
  t04OwnerPage: Page;
}

async function applyStorageState(context: BrowserContext, state: StorageState): Promise<void> {
  if (state.cookies.length > 0) {
    await context.addCookies(state.cookies);
  }

  for (const origin of state.origins) {
    if (origin.localStorage.length === 0) continue;
    await context.addInitScript(
      ({ targetOrigin, items }) => {
        if (window.location.origin !== targetOrigin) return;
        for (const item of items) window.localStorage.setItem(item.name, item.value);
      },
      { targetOrigin: origin.origin, items: origin.localStorage }
    );
  }
}

export const test = base.extend<T04TestFixtures, T04WorkerFixtures>({
  t04WorkerSession: [
    async ({ browser }, provide, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL;
      if (!baseURL) {
        throw new Error('playwright.t04.config.ts must set use.baseURL before T04 tests run.');
      }

      const owner = await seedT04Owner({ label: `worker-${workerInfo.workerIndex}` });
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();

      try {
        await signInWithTotp(page, owner);
        const storageState = await context.storageState();
        await provide({ owner, storageState });
      } catch (error) {
        const artifactDir = path.resolve('test-results', 't04', 'setup');
        fs.mkdirSync(artifactDir, { recursive: true });
        await page
          .screenshot({ path: path.join(artifactDir, `worker-${workerInfo.workerIndex}-login-failure.png`), fullPage: true })
          .catch(() => undefined);
        throw error;
      } finally {
        await context.close();
        await deleteT04Owner(owner.id);
      }
    },
    { scope: 'worker' },
  ],

  t04Owner: async ({}, provide) => {
    const owner = await seedT04Owner({ label: 'session' });
    try {
      await provide(owner);
    } finally {
      await deleteT04Owner(owner.id);
    }
  },

  t04Page: async ({ page, context, t04WorkerSession }, provide) => {
    await applyStorageState(context, t04WorkerSession.storageState);
    await provide(page);
  },

  t04OwnerPage: async ({ page, t04Owner }, provide) => {
    await signInWithTotp(page, t04Owner);
    await provide(page);
  },
});

export { expect };
