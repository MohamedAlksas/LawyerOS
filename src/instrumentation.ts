export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validate runtime environment at server startup.
    // Preserves builds that legitimately do not require live runtime secrets.
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { validateStartupEnv } = await import('@/lib/env');
      validateStartupEnv();
    }
  }
}
