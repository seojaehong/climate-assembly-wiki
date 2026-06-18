import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';

/**
 * 진행자 이메일+비밀번호 인증 훅.
 * - 마운트 시 현재 세션 로드 + onAuthStateChange 구독 (언마운트 시 해제).
 * - signIn(email, password): 비밀번호 로그인. 성공 시 onAuthStateChange로 session 갱신.
 * - signOut(): 로그아웃.
 * - env 미설정(getSupabase null) 시 inert 반환.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;

    sb.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string): Promise<{ error: Error | null }> {
    const sb = getSupabase();
    if (!sb) return { error: new Error('Supabase 미설정') };
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signOut(): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
  }

  return { session, email: session?.user?.email ?? null, signIn, signOut };
}
