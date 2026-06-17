import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.PUBLIC_SUPABASE_URL ?? '').trim();
const anon = (import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? '').trim();

let _client: SupabaseClient | null = null;

/** 브라우저용 anon 클라이언트. env 미설정 시 null (호출부에서 폴백 처리). */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anon) return null;
  if (!_client) _client = createClient(url, anon, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return _client;
}
