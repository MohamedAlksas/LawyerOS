import { spawnSync } from 'node:child_process';
import { validateTestEnvironment } from '../tests/helpers/test-db';

try {
  const env = validateTestEnvironment();
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: env.DATABASE_URL },
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Test database validation failed.');
  process.exitCode = 1;
}
