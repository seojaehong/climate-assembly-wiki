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
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setInitializationError('인증 연결을 사용할 수 없습니다.');
      return;
    }

    void sb.auth.getSession()
      .then(({ data, error }) => {
        if (error) {
          console.error('Canvas auth session load failed', error);
          setInitializationError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
          return;
        }
        setInitializationError(null);
        setSession(data.session);
      })
      .catch((error: unknown) => {
        console.error('Canvas auth session load failed', error);
        setInitializationError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
      });

    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string): Promise<{ error: Error | null }> {
    const sb = getSupabase();
    if (!sb) return { error: new Error('Supabase 미설정') };
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      return { error };
    } catch (error: unknown) {
      console.error('Canvas sign-in failed', error);
      return { error: error instanceof Error ? error : new Error('로그인 요청에 실패했습니다.') };
    }
  }

  async function signOut(): Promise<{ error: Error | null }> {
    const sb = getSupabase();
    if (!sb) return { error: new Error('Supabase 미설정') };
    try {
      const { error } = await sb.auth.signOut();
      return { error };
    } catch (error: unknown) {
      console.error('Canvas sign-out failed', error);
      return { error: error instanceof Error ? error : new Error('로그아웃 요청에 실패했습니다.') };
    }
  }

  return {
    session,
    email: session?.user?.email ?? null,
    initializationError,
    signIn,
    signOut,
  };
}
