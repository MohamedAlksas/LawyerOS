export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validate runtime environment at server startup.
    // Preserves builds that legitimately do not require live runtime secrets.
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      try {
        const { validateStartupEnv } = await import('@/lib/env');
        const env = validateStartupEnv();
        if (env.NODE_ENV === 'production' && !env.PARTY_IDENTITY_ENCRYPTION_KEY) {
          process.stderr.write(
            '[Startup Warning] PARTY_IDENTITY_ENCRYPTION_KEY is not configured; saving or revealing party identity numbers will fail until set.\n'
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[Startup Failure] ${message}\n`);
        process.exit(1);
      }
    }
  }
}
