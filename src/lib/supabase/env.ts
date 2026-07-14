export interface SupabasePublicEnv {
  url: string;
  publishableKey: string;
}

export function getSupabasePublicEnv(
  env: Record<string, string | undefined> = process.env,
): SupabasePublicEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function requireSupabasePublicEnv(): SupabasePublicEnv {
  const value = getSupabasePublicEnv();
  if (!value) {
    throw new Error('Supabaseの公開環境変数が設定されていません。');
  }
  return value;
}
