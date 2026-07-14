import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try { await (await createClient()).auth.signOut(); } catch { /* Missing env is handled by returning home. */ }
  return NextResponse.redirect(new URL('/today', request.url), 303);
}
