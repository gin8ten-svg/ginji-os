'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { normalGoogleOAuthOptions } from '@/lib/auth/oauth-options';
import { createClient } from '@/lib/supabase/client';
import { getSupabasePublicEnv } from '@/lib/supabase/env';

const errors: Record<string, string> = {
  missing_code: '認証情報が返されませんでした。もう一度お試しください。',
  exchange_failed: 'ログイン処理を完了できませんでした。SupabaseのOAuth設定を確認してください。',
};

function LoginContent() {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const configured = Boolean(getSupabasePublicEnv());
  const error = searchParams.get('error');

  async function login() {
    setPending(true);
    setClientError(null);
    try {
      const { error: oauthError } = await createClient().auth.signInWithOAuth({
        provider: 'google',
        options: normalGoogleOAuthOptions(window.location.origin),
      });
      if (oauthError) throw oauthError;
    } catch (loginError) {
      setClientError(loginError instanceof Error ? loginError.message : 'ログインを開始できませんでした。');
      setPending(false);
    }
  }

  return <section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <h2 className="text-xl font-semibold">Googleでログイン</h2>
    <p className="mt-2 text-sm text-slate-600">ログインするとタスクとルーティンをSupabaseへ保存します。未ログインの間は端末内データをそのまま利用できます。</p>
    {!configured ? <p role="alert" className="mt-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">Supabaseの公開環境変数が未設定です。.env.localを確認してください。</p> : null}
    {error || clientError ? <p role="alert" className="mt-4 rounded-2xl bg-rose-50 p-3 text-sm text-rose-700">{clientError ?? errors[error ?? ''] ?? '認証エラーが発生しました。'}</p> : null}
    <button type="button" disabled={!configured || pending} onClick={() => void login()} className="mt-5 min-h-11 w-full rounded-full bg-brand-600 px-4 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? 'Googleへ移動中…' : 'Googleで続ける'}</button>
    <Link href="/today" className="mt-4 block text-center text-sm font-medium text-slate-600">ログインせずに使う</Link>
  </section>;
}

export default function LoginPage() {
  return <Suspense fallback={<section className="mx-auto max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p className="text-sm text-slate-600">ログイン画面を読み込んでいます…</p></section>}><LoginContent /></Suspense>;
}
