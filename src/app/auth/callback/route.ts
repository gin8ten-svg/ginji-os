import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  try {
    const { error } = await (await createClient()).auth.exchangeCodeForSession(code);
    if (error) throw error;
    return NextResponse.redirect(new URL('/today', request.url));
  } catch {
    return NextResponse.redirect(new URL('/login?error=exchange_failed', request.url));
  }
}
