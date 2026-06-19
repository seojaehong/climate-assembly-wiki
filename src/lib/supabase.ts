import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 공개(publishable) anon 키 + URL — 어차피 클라이언트 번들에 노출되는 공개 자격증명이며 RLS가 데이터를 보호한다.
// Cloudflare Build env var(PUBLIC_SUPABASE_*)가 있으면 그것이 우선, 없으면 아래 fallback으로 prod 동작 보장.
const FALLBACK_URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsZXl1a25qbnByc2Nrc3N4dnJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTEyMjQsImV4cCI6MjA4ODk2NzIyNH0.fP_OG2ZpP7KDtPebY4Wp20mMWlVMn5KQad7UpJ4hx08';

const url = ((import.meta.env.PUBLIC_SUPABASE_URL as string) || FALLBACK_URL).trim();
const anon = ((import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string) || FALLBACK_ANON).trim();

let _client: SupabaseClient | null = null;

/** 브라우저용 anon 클라이언트. env 미설정 시 null (호출부에서 폴백 처리). */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anon) return null;
  if (!_client) _client = createClient(url, anon, {
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return _client;
}
