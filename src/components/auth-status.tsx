'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getSupabasePublicEnv } from '@/lib/supabase/env';

export function AuthStatus() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!getSupabasePublicEnv()) return;
    const client = createClient();
    void client.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  if (!email) return <Link href="/login" className="rounded-full bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700">ログイン</Link>;
  return <div className="flex items-center gap-2"><span className="hidden max-w-48 truncate text-xs text-slate-500 sm:inline">{email}</span><form action="/auth/logout" method="post"><button type="submit" className="rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">ログアウト</button></form></div>;
}
