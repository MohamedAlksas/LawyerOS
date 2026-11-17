/**
 * Sanitizes and validates a requested return destination route (R04-06).
 * Strictly requires a local relative path, rejecting external schemes,
 * protocol-relative URLs, backslashes, control characters, and open redirect vectors.
 * Enforces an invariant check and supported route allowlist on the final candidate string.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') {
    return '/';
  }

  const trimmed = raw.trim();

  // Must begin with a single forward slash and not multiple slashes or backslashes
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }

  // Reject URL scheme indicators, backslashes, or control characters early
  if (trimmed.includes('://') || trimmed.includes('\\') || /[\x00-\x1F\x7F]/.test(trimmed)) {
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
    // 4. Contains no control characters or protocol schemes
    if (
      !/^\/(?:[a-zA-Z0-9].*|\?.*)?$/.test(candidate) ||
      candidate.includes('//') ||
      candidate.includes('\\') ||
      candidate.includes('://') ||
      /[\x00-\x1F\x7F]/.test(candidate)
    ) {
      return '/';
    }

    // Supported route allowlist
    const isAllowedRoute =
      candidate === '/' ||
      candidate.startsWith('/settings/security') ||
      candidate.startsWith('/offline');

    if (!isAllowedRoute) {
      return '/';
    }

    return candidate;
  } catch {
    return '/';
  }
}

