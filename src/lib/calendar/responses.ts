import 'server-only';
import { NextResponse } from 'next/server';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

export function calendarJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export function withPrivateCache(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
