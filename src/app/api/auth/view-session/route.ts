import { NextResponse } from 'next/server';
import { getTrustedOrigins } from '@/lib/auth';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError } from '@/modules/identity/types';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  if (request.headers.get('sec-fetch-site')?.trim().toLowerCase() === 'cross-site') {
    return new NextResponse(null, { status: 403, headers });
  }
  try {
    const origin = request.headers.get('origin');
    if (origin !== null && !getTrustedOrigins().has(origin)) {
      return new NextResponse(null, { status: 403, headers });
    }
    const actor = await requireActor({ headers: request.headers, touchSession: false });
    return NextResponse.json({ actorId: actor.id, sessionId: actor.sessionId, role: actor.role, name: actor.name, email: actor.email }, { headers });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof AuthenticationError ? 401 : 503, headers });
  }
}
