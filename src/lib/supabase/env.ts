export interface SupabasePublicEnv {
  url: string;
  publishableKey: string;
}

export function parseSupabasePublicEnv(
  urlValue: string | undefined,
  publishableKeyValue: string | undefined,
): SupabasePublicEnv | null {
  const url = urlValue?.trim();
  const publishableKey = publishableKeyValue?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  return parseSupabasePublicEnv(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function requireSupabasePublicEnv(): SupabasePublicEnv {
  const value = getSupabasePublicEnv();
  if (!value) {
    throw new Error('Supabaseの公開環境変数が設定されていません。');
  }
  return value;
}
