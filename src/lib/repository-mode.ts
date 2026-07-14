export type RepositoryMode = 'local' | 'supabase';

export function repositoryMode(supabaseConfigured: boolean, userId: string | null | undefined): RepositoryMode {
  return supabaseConfigured && Boolean(userId) ? 'supabase' : 'local';
}
