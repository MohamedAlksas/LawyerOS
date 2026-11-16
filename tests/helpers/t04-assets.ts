import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { T04_ROUTES } from './t04-constants';

/**
 * Static-asset helpers for T04-06 and the offline fallback check in T04-05.
 * They inspect the bytes the server actually returns, not merely a 200 status.
 */

export interface PngDimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = '89504e470d0a1a0a';

export function pngDimensions(buffer: Buffer): PngDimensions {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new Error(`Asset is not a PNG (first bytes: ${buffer.subarray(0, 8).toString('hex')})`);
  }
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('PNG is missing the required IHDR chunk');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export interface SvgInspection {
  hasSvgRoot: boolean;
  viewBox: string | null;
  width: string | null;
  height: string | null;
}

export function inspectSvg(text: string): SvgInspection {
  const openingTag = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const attribute = (name: string): string | null => {
    const match = openingTag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return match?.[1] ?? null;
  };
  return {
    hasSvgRoot: openingTag.length > 0,
    viewBox: attribute('viewBox'),
    width: attribute('width'),
    height: attribute('height'),
  };
}

export interface OfflineRoute {
  path: string;
  response: APIResponse;
}

/**
 * The contract allows either `/offline` or `/offline.html`; this returns the
 * first candidate that serves an HTML document and records the served path.
 */
export async function findOfflineRoute(request: APIRequestContext): Promise<OfflineRoute> {
  const attempts: string[] = [];

  for (const candidate of [T04_ROUTES.offline, T04_ROUTES.offlineHtml]) {
    const response = await request.get(candidate);
    const contentType = response.headers()['content-type'] ?? '';
    attempts.push(`${candidate} -> ${response.status()} ${contentType || '(no content-type)'}`);
    if (response.status() === 200 && contentType.includes('text/html')) {
      return { path: new URL(response.url()).pathname, response };
    }
  }

  throw new Error(
    `Neither offline fallback route served HTML. Attempts: ${attempts.join('; ')}. ` +
      'The contract requires /offline or /offline.html.'
  );
}

export function expectHtmlResponse(response: APIResponse): void {
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type'] ?? '').toContain('text/html');
}
