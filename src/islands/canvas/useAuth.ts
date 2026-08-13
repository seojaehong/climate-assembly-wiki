import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';

interface CanvasAuthSessionResult {
  data: { session: Session | null };
  error: Error | null;
}

const AUTH_USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_REVIEWER_ID = /^auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Checks the canonical non-email reviewer identity emitted by the authenticated UI. */
export function isAuthenticatedReviewerId(value: string): boolean {
  return AUTH_REVIEWER_ID.test(value);
}

/** Derives a non-email review audit identity from the authenticated Supabase user UUID. */
export function authenticatedReviewerId(userId: string): string | null {
  const normalized = userId.trim().toLowerCase();
  return AUTH_USER_UUID.test(normalized) ? `auth-user:${normalized}` : null;
}

/** Acquires an auth action lock synchronously so duplicate UI events cannot race React state. */
export async function runExclusiveCanvasAuthOperation(
  lock: { current: boolean },
  action: () => Promise<void>,
  onBusyChange: (busy: boolean) => void,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  onBusyChange(true);
  try {
    await action();
    return true;
  } finally {
    lock.current = false;
    onBusyChange(false);
  }
}

/** Applies an initial Canvas auth read only while it is still the latest auth operation. */
export async function completeCanvasAuthSessionLoad(
  action: () => PromiseLike<CanvasAuthSessionResult>,
  isCurrent: () => boolean,
  onSession: (session: Session | null) => void,
  onError: (message: string | null) => void,
): Promise<void> {
  try {
    const { data, error } = await action();
    if (!isCurrent()) return;
    if (error) {
      console.error('Canvas auth session load failed', error);
      onSession(null);
      onError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
      return;
    }
    onSession(data.session);
    onError(null);
  } catch (error: unknown) {
    if (!isCurrent()) return;
    console.error('Canvas auth session load failed', error);
    onSession(null);
    onError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
  }
}

/**
 * 진행자 이메일+비밀번호 인증 훅.
 * - 마운트 시 현재 세션 로드 + onAuthStateChange 구독 (언마운트 시 해제).
 * - signIn(email, password): 비밀번호 로그인. 성공 시 onAuthStateChange로 session 갱신.
 * - signOut(): 로그아웃.
 * - env 미설정(getSupabase null) 시 inert 반환.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const authGeneration = useRef(0);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setInitializationError('인증 연결을 사용할 수 없습니다.');
      return;
    }

    let active = true;
    const generation = authGeneration.current + 1;
    authGeneration.current = generation;
    void completeCanvasAuthSessionLoad(
      () => sb.auth.getSession(),
      () => active && authGeneration.current === generation,
      (nextSession) => {
        setSessionGeneration(generation);
        setSession(nextSession);
      },
      setInitializationError,
    );

    const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
      if (!active) return;
      authGeneration.current += 1;
      setSessionGeneration(authGeneration.current);
      setSession(s);
      setInitializationError(null);
    });

    return () => {
      active = false;
      authGeneration.current += 1;
      sub.subscription.unsubscribe();
    };
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
    generation: sessionGeneration,
    email: session?.user?.email ?? null,
    initializationError,
    signIn,
    signOut,
  };
}
