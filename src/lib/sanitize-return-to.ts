/**
 * Sanitizes and validates a requested return destination route (R04-06).
 * Strictly requires a local relative path, rejecting external schemes,
 * protocol-relative URLs, backslashes, control characters, and open redirect vectors.
 */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') {
    return '/';
  }

  const trimmed = raw.trim();

  // Must begin with a single forward slash
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }

  // Reject URL scheme indicators and backslashes
  if (trimmed.includes('://') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return '/';
  }

  try {
    const parsed = new URL(trimmed, 'http://127.0.0.1');
    // Ensure origin was not spoofed and path is local
    if (parsed.origin !== 'http://127.0.0.1') {
      return '/';
    }
    // Return relative path + search query
    return parsed.pathname + parsed.search;
  } catch {
    return '/';
  }
}
