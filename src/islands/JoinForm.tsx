import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '../lib/supabase';

const TOKEN_KEY = 'cv-participant-token';

// 180명 폰 참여 — 의제/의견 제출. 모더레이터 캔버스에 실시간 등장.
export default function JoinForm({ sessionSlug }: { sessionSlug: string }) {
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [jo, setJo] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const token = useRef<string>('');

  useEffect(() => {
    const sb = getSupabase(); if (!sb) { setErr('연결 설정이 없습니다.'); return; }
    let cancelled = false;
    (async () => {
      const { data: sess } = await sb.schema('climate_vote').from('session').select('id').eq('slug', sessionSlug).single();
      if (!sess || cancelled) { if (!cancelled) setErr('세션을 찾을 수 없습니다.'); return; }
      sessionId.current = sess.id;
      let t = '';
      try { t = localStorage.getItem(TOKEN_KEY) || ''; } catch { /* noop */ }
      if (!t) { t = crypto.randomUUID(); try { localStorage.setItem(TOKEN_KEY, t); } catch { /* noop */ } }
      token.current = t;
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [sessionSlug]);

  const submit = async () => {
    const body = text.trim();
    if (!body || !sessionId.current) return;
    const sb = getSupabase(); if (!sb) return;
    setSending(true); setErr(null);
    // 참여자 등록(최초 1회, 이름/조 갱신) — upsert
    await sb.schema('climate_vote').from('participant')
      .upsert({ token: token.current, session_id: sessionId.current, name: name.trim() || null, group_label: jo.trim() || null }, { onConflict: 'token' });
    const { error } = await sb.schema('climate_vote').from('agenda').insert({
      session_id: sessionId.current, text: body, jo: jo.trim() || null,
      zone: '미분류', status: 'active',
      x: Math.round(40 + Math.random() * 1700), y: Math.round(100 + Math.random() * 560),
      created_by: token.current,
    });
    setSending(false);
    if (error) { setErr(error.message); return; }
    setText('');
    setSentCount((c) => c + 1);
  };

  const wrap: React.CSSProperties = { maxWidth: 560, margin: '0 auto', padding: '24px 18px 60px', fontFamily: "'Pretendard',system-ui,sans-serif" };
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '14px 16px', fontSize: 17, border: '2px solid #cbd5e1', borderRadius: 12, marginBottom: 12 };

  if (err) return <div style={wrap}><p style={{ color: '#dc2626', fontWeight: 700 }}>{err}</p></div>;
  if (!ready) return <div style={wrap}><p style={{ color: '#6b7280' }}>불러오는 중…</p></div>;

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f1a2a', margin: '0 0 6px' }}>의제 제출</h1>
      <p style={{ fontSize: 15, color: '#4a5568', margin: '0 0 20px' }}>기후 관련 의제·의견을 자유롭게 적어 주세요. 진행자 화면에 바로 올라갑니다.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (선택)" style={field} />
      <input value={jo} onChange={(e) => setJo(e.target.value)} placeholder="조 (선택, 예: A조)" style={field} />
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="제안할 의제·의견을 입력하세요" rows={4} style={{ ...field, resize: 'vertical', fontWeight: 700 }} />
      <button onClick={submit} disabled={!text.trim() || sending}
        style={{ width: '100%', padding: '16px', fontSize: 18, fontWeight: 800, borderRadius: 12, border: 'none', color: '#fff', cursor: text.trim() && !sending ? 'pointer' : 'not-allowed', background: text.trim() && !sending ? '#1f4e79' : '#9ca3af' }}>
        {sending ? '제출 중…' : '제출하기'}
      </button>
      {sentCount > 0 && <p style={{ marginTop: 16, color: '#1a9e5c', fontWeight: 800, textAlign: 'center' }}>✓ {sentCount}건 제출됨 — 계속 추가할 수 있어요</p>}
    </div>
  );
}
