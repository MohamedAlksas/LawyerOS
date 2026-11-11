import { NextResponse } from 'next/server';
import { checkDatabaseReadiness } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const readiness = await checkDatabaseReadiness(3000);

    if (!readiness.ok) {
      return NextResponse.json(
        {
          status: 'fail',
          check: 'readiness',
          timestamp: new Date().toISOString(),
          database: {
            status: 'disconnected',
            error: readiness.error ?? 'Database unavailable',
            latencyMs: readiness.latencyMs,
          },
        },
        {
          status: 503,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        }
      );
    }

    return NextResponse.json(
      {
        status: 'pass',
        check: 'readiness',
        timestamp: new Date().toISOString(),
        database: {
          status: 'connected',
          latencyMs: readiness.latencyMs,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (error: unknown) {
    const safeError =
      error instanceof Error && error.name === 'EnvironmentValidationError'
        ? 'Database configuration missing or invalid'
        : 'Database readiness check failed';

    return NextResponse.json(
      {
        status: 'fail',
        check: 'readiness',
        timestamp: new Date().toISOString(),
        database: {
          status: 'disconnected',
          error: safeError,
          latencyMs: 0,
        },
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  }
}
