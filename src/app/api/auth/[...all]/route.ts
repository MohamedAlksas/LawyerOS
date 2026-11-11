import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  return auth.handler(request);
}

export async function POST(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname.includes('/sign-up')) {
    return NextResponse.json(
      { error: 'Public registration is disabled.' },
      { status: 403 }
    );
  }
  return auth.handler(request);
}