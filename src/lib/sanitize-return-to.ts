// Canonical UUID v1-v5/random pattern (8-4-4-4-12 hex with hyphens)
const UUID_SEGMENT = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ALLOWED_EXACT_ROUTES = new Set([
  '/',
  '/search',
  '/matters',
  '/matters/new',
  '/parties',
  '/parties/new',
  '/settings/reference',
  '/settings/security',
  '/settings/security/sessions',
  '/offline',
]);

const ALLOWED_PREFIX_ROUTES: string[] = [];

const ALLOWED_PATTERN_ROUTES = [
  new RegExp(`^/matters/${UUID_SEGMENT}$`),
  new RegExp(`^/matters/${UUID_SEGMENT}/edit$`),
  new RegExp(`^/matters/${UUID_SEGMENT}/proceedings$`),
  new RegExp(`^/matters/${UUID_SEGMENT}/proceedings/new$`),
  new RegExp(`^/matters/${UUID_SEGMENT}/proceedings/${UUID_SEGMENT}$`),
  new RegExp(`^/matters/${UUID_SEGMENT}/proceedings/${UUID_SEGMENT}/edit$`),
  new RegExp(`^/hearings/${UUID_SEGMENT}$`),
  new RegExp(`^/hearings/${UUID_SEGMENT}/result$`),
  new RegExp(`^/parties/${UUID_SEGMENT}$`),
  new RegExp(`^/parties/${UUID_SEGMENT}/edit$`),
];

/**
 * Sanitizes and validates a requested return destination route (R04-06 / C21).
 * Strictly requires a local relative path, rejecting external schemes,
 * protocol-relative URLs, backslashes, control characters, and open redirect vectors.
 * Enforces an invariant check and supported route allowlist on the final candidate string.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') {
    return '/';
  }

  // Reject control characters anywhere in the raw input immediately (fail-closed against CRLF / null-byte injection)
  if (/[\x00-\x1F\x7F]/.test(raw)) {
    return '/';
  }

  const trimmed = raw.trim();

  // Must begin with a single forward slash and not multiple slashes or backslashes
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }

  // Reject URL scheme indicators, backslashes, or pseudo-protocol schemes
  if (
    trimmed.includes('://') ||
    trimmed.includes('\\') ||
    /(?:javascript|data|vbscript):/i.test(trimmed)
  ) {
    return '/';
  }

  try {
    const parsed = new URL(trimmed, 'http://127.0.0.1');
    // Ensure origin was not spoofed and path is local
    if (parsed.origin !== 'http://127.0.0.1') {
      return '/';
    }

    const candidate = parsed.pathname + parsed.search;

    // Strict invariant check on final candidate:
    // 1. Strictly begins with a single '/' followed by an alphanumeric character, or ends immediately ('/'), or starts with query ('/?')
    // 2. Contains no consecutive slashes '//'
    // 3. Contains no backslashes '\'
    // 4. Contains no control characters or protocol schemes (including pseudo-protocols)
    if (
      !/^\/(?:[a-zA-Z0-9].*|\?.*)?$/.test(candidate) ||
      candidate.includes('//') ||
      candidate.includes('\\') ||
      candidate.includes('://') ||
      /(?:javascript|data|vbscript):/i.test(candidate) ||
      /[\x00-\x1F\x7F]/.test(candidate)
    ) {
      return '/';
    }

    // Supported route allowlist check on pathname
    const pathname = parsed.pathname;
    const normalizedPath =
      pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

    const isAllowedRoute =
      ALLOWED_EXACT_ROUTES.has(normalizedPath) ||
      ALLOWED_PREFIX_ROUTES.some((prefix) => normalizedPath.startsWith(prefix)) ||
      ALLOWED_PATTERN_ROUTES.some((pattern) => pattern.test(normalizedPath));

    if (!isAllowedRoute) {
      return '/';
    }

    return candidate;
  } catch {
    return '/';
  }
}

