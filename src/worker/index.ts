import crypto from 'node:crypto';
import { getPrismaClient } from '@/lib/auth';
import { closeDbPool } from '@/lib/db';
import { isWorkerDispatchDisabled, redactErrorMessage, validateStartupEnv } from '@/lib/env';
import { runReminderWorkerTick } from './reminder-worker';

const DEFAULT_POLL_INTERVAL_MS = 60_000;

async function main() {
  const env = validateStartupEnv();
  const intervalMs = Math.max(
    1_000,
    env.WORKER_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS
  );
  const workerId = `worker-${process.pid}-${crypto.randomUUID().slice(0, 6)}`;
  const restoreMode = isWorkerDispatchDisabled();

  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let activeTick: Promise<void> | null = null;

  process.stdout.write(
    `[ReminderWorker] starting workerId=${workerId} intervalMs=${intervalMs} restoreMode=${restoreMode}\n`
  );

  const executeTick = async () => {
    try {
      const result = await runReminderWorkerTick({ workerId });
      if (result.claimedCount > 0 || result.failedCount > 0 || result.restoreMode) {
        process.stdout.write(
          `[ReminderWorker] tick workerId=${workerId} restoreMode=${result.restoreMode} claimed=${result.claimedCount} delivered=${result.deliveredCount} cancelled=${result.cancelledCount} failed=${result.failedCount}\n`
        );
      }
    } catch (error) {
      process.stderr.write(
        `[ReminderWorker] tick error: ${redactErrorMessage(error)}\n`
      );
    }
  };

  const scheduleNext = () => {
    if (stopping) return;
    timer = setTimeout(() => {
      activeTick = executeTick().finally(() => {
        activeTick = null;
        scheduleNext();
      });
    }, intervalMs);
  };

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    process.stdout.write(`[ReminderWorker] shutting down (${signal})...\n`);
    if (activeTick) {
      await activeTick.catch(() => {});
    }
    await getPrismaClient().$disconnect().catch(() => {});
    await closeDbPool().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  activeTick = executeTick().finally(() => {
    activeTick = null;
    scheduleNext();
  });
}

void main();