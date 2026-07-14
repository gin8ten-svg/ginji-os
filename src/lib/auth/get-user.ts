import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/** Uses Auth server validation; do not trust getSession() for authorization. */
export async function getAuthenticatedUser(): Promise<User | null> {
  const { data, error } = await (await createClient()).auth.getUser();
  if (error) return null;
  return data.user;
}
