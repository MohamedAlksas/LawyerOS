import { test, expect } from '../helpers/t04-fixtures';
import { T04_COPY, T04_ROUTES, T04_TEST_IDS } from '../helpers/t04-constants';

/**
 * T04-05 — loading and recoverable-error presentation states.
 *
 * PROVISIONAL / NOT EXECUTED. The interface contract defines the attributes of
 * these states (sections 6.2 and 6.3) but does not define any route, API call or
 * user action that triggers an asynchronous retrieval or a recoverable error in
 * T04. The delivered routes are static auth screens and a static empty state.
 *
 * Authoring a test that invents a trigger (for example delaying an arbitrary RSC
 * request) would encode an implementation guess as an acceptance expectation and
 * could pass or fail for reasons unrelated to the contract. These cases stay
 * fixme until the contract names a trigger and selector. The gap is reported in
 * the submission rather than hidden behind a vacuous conditional assertion.
 */

test.describe('presentation primitives awaiting a contract-defined trigger @once', () => {
  test.fixme(
    'loading indicator exposes status semantics during async retrieval @once',
    async ({ t04Page: page }) => {
      await page.goto(T04_ROUTES.home);

      const loading = page.getByTestId(T04_TEST_IDS.loadingIndicator);
      await expect(loading).toBeVisible();
      await expect(loading).toHaveAttribute('role', 'status');
      await expect(loading).toHaveAttribute('aria-busy', 'true');
      await expect(loading).toHaveAttribute('aria-label', T04_COPY.loadingLabel);

      // A test must also prove the indicator disappears when retrieval settles.
      await expect(loading).toBeHidden();
    }
  );

  test.fixme(
    'recoverable error renders Arabic copy, retry, and recovers on click @once',
    async ({ t04Page: page }) => {
      await page.goto(T04_ROUTES.home);

      const error = page.getByTestId(T04_TEST_IDS.errorContainer);
      await expect(error).toBeVisible();
      await expect(error).toHaveAttribute('role', 'alert');

      const retry = page.getByTestId(T04_TEST_IDS.errorRetryButton);
      await expect(retry).toHaveText(T04_COPY.errorRetry);
      await retry.click();

      await expect(error).toBeHidden();
    }
  );
});
