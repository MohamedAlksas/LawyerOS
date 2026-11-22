import { NextResponse } from 'next/server';
import { requireActor } from '@/modules/identity/require-actor';
import { AuthenticationError } from '@/modules/identity/types';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const actor = await requireActor({ headers: request.headers, touchSession: false });
    return NextResponse.json({ actorId: actor.id, sessionId: actor.sessionId, role: actor.role }, { headers });
  } catch (error) {
    return new NextResponse(null, { status: error instanceof AuthenticationError ? 401 : 503, headers });
  }
}
