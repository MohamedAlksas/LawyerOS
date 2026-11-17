import { test, expect } from '../helpers/t04-fixtures';
import { T04_COPY, T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';

/**
 * T04-05 — loading and recoverable-error presentation states.
 *
 * Verifies loading indicator during asynchronous retrieval and recoverable error
 * container with retry capability, triggered via the health/readiness probe on the home dashboard.
 */

test.describe('presentation states during async retrieval and recovery @once', () => {
  test(
    'loading indicator exposes status semantics during async retrieval @once',
    async ({ t04Page: page }) => {
      let resolveRoute: () => void = () => {};
      const holdPromise = new Promise<void>((resolve) => {
        resolveRoute = resolve;
      });

      await page.route('**/api/health/ready', async (route) => {
        await holdPromise;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ready', timestamp: new Date().toISOString() }),
        });
      });

      await page.goto(T04_ROUTES.home);

      const loading = page.getByTestId(T04_TEST_IDS.loadingIndicator);
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute('role', 'status');
      await expect(loading).toHaveAttribute('aria-busy', 'true');
      await expect(loading).toHaveAttribute('aria-label', T04_COPY.loadingLabel);

      // Release the held route to simulate async retrieval completion
      resolveRoute();

      // Indicator must transition to hidden and genuine empty state must be visible
      await expect(loading).toBeHidden();
      await expect(page.getByTestId(T04_TEST_IDS.emptyState)).toBeVisible();
    }
  );

  test(
    'recoverable error renders Arabic copy, retry, and recovers on click @once',
    async ({ t04Page: page }) => {
      let shouldFail = true;

      await page.route('**/api/health/ready', async (route) => {
        if (shouldFail) {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error' }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ status: 'ready', timestamp: new Date().toISOString() }),
          });
        }
      });

      await page.goto(T04_ROUTES.home);

      const error = page.getByTestId(T04_TEST_IDS.errorContainer);
      await expect(error).toBeVisible();
      await expect(error).toHaveAttribute('role', 'alert');

      const retry = page.getByTestId(T04_TEST_IDS.errorRetryButton);
      await expect(retry).toBeVisible();
      await expect(retry).toHaveText(T04_COPY.errorRetry);

      // Configure mock to succeed on retry and click the button
      shouldFail = false;
      await retry.click();

      // Error container must transition to hidden and genuine empty state must be visible
      await expect(error).toBeHidden();
      await expect(page.getByTestId(T04_TEST_IDS.emptyState)).toBeVisible();
    }
  );
});
