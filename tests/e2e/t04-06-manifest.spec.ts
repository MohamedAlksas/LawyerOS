import { test, expect } from '../helpers/t04-fixtures';
import { T04_MANIFEST, T04_ROUTES } from '../helpers/t04-constants';
import { inspectSvg, pngDimensions } from '../helpers/t04-assets';

/**
 * T04-06 — manifest and icon contract.
 *
 * The manifest is fetched as a document asset and parsed; icons are fetched as
 * bytes so dimensions come from the PNG IHDR, not from the JSON's own claim.
 */

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

test('manifest is served with the contract fields and icons @once', async ({ request }) => {
  const response = await request.get(T04_MANIFEST.path);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type'] ?? '').toMatch(/^application\/manifest\+json/);

  const manifest = (await response.json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    name: T04_MANIFEST.name,
    short_name: T04_MANIFEST.shortName,
    description: T04_MANIFEST.description,
    start_url: T04_MANIFEST.startUrl,
    display: T04_MANIFEST.display,
    orientation: T04_MANIFEST.orientation,
    dir: T04_MANIFEST.dir,
    lang: T04_MANIFEST.lang,
    background_color: T04_MANIFEST.backgroundColor,
    theme_color: T04_MANIFEST.themeColor,
  });

  expect(Array.isArray(manifest.icons), 'Manifest icons must be an array').toBe(true);
  const icons = manifest.icons as ManifestIcon[];
  expect(icons).toHaveLength(T04_MANIFEST.icons.length);
  for (const expectedIcon of T04_MANIFEST.icons) {
    // Match the contract fields without rejecting harmless extra manifest keys.
    const actual = icons.find((icon) => icon.src === expectedIcon.src);
    expect(actual, `Manifest is missing icon ${expectedIcon.src}`).toBeDefined();
    expect(actual, `Icon ${expectedIcon.src} does not match the contract`).toMatchObject(
      expectedIcon
    );
  }
});

test('every manifest icon is reachable and matches its declared format @once', async ({
  request,
}) => {
  for (const icon of T04_MANIFEST.icons) {
    const iconType: string = icon.type;
    const response = await request.get(icon.src);
    expect(response.status(), `Icon ${icon.src} is not reachable`).toBe(200);
    expect(
      response.headers()['content-type'] ?? '',
      `Icon ${icon.src} has the wrong content type`
    ).toContain(iconType);

    const body = await response.body();
    if (iconType === 'image/png') {
      const dimensions = pngDimensions(body);
      expect(
        `${dimensions.width}x${dimensions.height}`,
        `Icon ${icon.src} declares ${icon.sizes}`
      ).toBe(icon.sizes);
    } else if (iconType === 'image/svg+xml') {
      const svg = inspectSvg(body.toString('utf8'));
      expect(svg.hasSvgRoot, `Icon ${icon.src} is not an SVG document`).toBe(true);
      expect(svg.viewBox, `Icon ${icon.src} needs a viewBox to scale to sizes="any"`).not.toBeNull();
    } else {
      throw new Error(`Unexpected manifest icon type: ${iconType}`);
    }
  }

  const maskable = T04_MANIFEST.icons.find((icon) => icon.purpose === 'maskable');
  expect(maskable, 'The contract requires a maskable icon').toBeDefined();
  expect(maskable!.sizes).toBe('512x512');
});

test('the document links the manifest and theme colour @once', async ({ t04Page: page }) => {
  await page.goto(T04_ROUTES.home);

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    T04_MANIFEST.path
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    'content',
    /^#14566B$/i
  );
});
