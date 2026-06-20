import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { getSupabase } from '../lib/supabase';

/* ============================================================
   그득이 RAG 챗봇 — 기후시민회의 자료 도우미
   재사용 모듈: props로 defaultSource·endpoint·placeholder 파라미터화.
   백엔드(edge function `chat`)가 정확도(헛소리 0)를 보장하고,
   UI는 "출처를 항상 투명하게" 노출하는 데 집중한다.
   ============================================================ */

// 소스 정의 — 필터 토글과 인용 배지가 공유하는 단일 진실원(SaaS 모듈화 핵심)
type SourceKey = 'overseas-cases' | 'kei-expert-agenda';
const SOURCES: Record<SourceKey, { label: string; emoji: string; bg: string; fg: string }> = {
  'overseas-cases': { label: '해외사례', emoji: '🌍', bg: 'var(--color-info-bg)', fg: 'var(--color-info)' },
  'kei-expert-agenda': { label: '국내·전문가 의제', emoji: '🇰🇷', bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
};
function sourceMeta(key: string) {
  return SOURCES[key as SourceKey] ?? { label: key, emoji: '📄', bg: 'var(--color-bg-subtle)', fg: 'var(--color-fg-muted)' };
}

// 상단 필터 — '전체'(null) + 두 소스
const FILTERS: { value: SourceKey | null; label: string; emoji: string }[] = [
  { value: null, label: '전체', emoji: '✨' },
  { value: 'overseas-cases', label: SOURCES['overseas-cases'].label, emoji: SOURCES['overseas-cases'].emoji },
  { value: 'kei-expert-agenda', label: SOURCES['kei-expert-agenda'].label, emoji: SOURCES['kei-expert-agenda'].emoji },
];

const EXAMPLES = [
  '재생에너지 지역 갈등 해결책은?',
  '탄소세 관련 해외 사례',
  '청소년 기후교육 사례',
  '기후시민회의는 어떻게 운영되나요?',
];

interface Citation {
  id: string; source: string; doc: string; ref_id: string;
  title: string; category: string; similarity: number;
}
interface ChatResponse {
  found: boolean; answer: string; citations?: Citation[];
  abstained: boolean; top_similarity?: number; error?: string;
}
type Status = 'ok' | 'abstained' | 'error';
interface Msg {
  role: 'user' | 'bot';
  text: string;
  citations?: Citation[];
  status?: Status; // bot 메시지의 분기 — ok / abstained(정직) / error(재시도)
}

export interface ChatBotProps {
  /** 진입 시 기본 소스 필터. 기본 null(전체). */
  defaultSource?: SourceKey | null;
  /** 호출할 edge function 이름. 기본 'chat'. */
  endpoint?: string;
  /** 검색 결과 개수 k. 기본 10(백엔드 기본값). */
  k?: number;
}

// ── 스타일(인라인 객체, CanvasBoard 톤) — 모두 디자인 토큰 기반 → 다크/라이트·WCAG 자동 충족 ──
const S = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', minHeight: '100dvh' } as CSSProperties,
  header: { textAlign: 'center', padding: 'var(--space-4) 0 var(--space-2)' } as CSSProperties,
  title: { fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--color-fg)', margin: 0, letterSpacing: 'var(--tracking-korean)' } as CSSProperties,
  sub: { fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)', margin: 'var(--space-2) 0 0' } as CSSProperties,
  filterRow: { display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', flexWrap: 'wrap', margin: 'var(--space-4) 0' } as CSSProperties,
  thread: { flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', padding: 'var(--space-2) 0 var(--space-6)' } as CSSProperties,
  bubbleUser: { alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--color-accent)', color: 'var(--color-accent-fg)', borderRadius: 'var(--radius-lg)', borderBottomRightRadius: 'var(--radius-xs)', padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)', lineHeight: 'var(--leading-normal)', whiteSpace: 'pre-wrap' } as CSSProperties,
  botRow: { display: 'flex', gap: 'var(--space-3)', alignSelf: 'flex-start', maxWidth: '92%' } as CSSProperties,
  avatar: { flexShrink: 0, width: 40, height: 40, borderRadius: 'var(--radius-full)', background: 'var(--color-accent-subtle)', display: 'grid', placeItems: 'center', fontSize: 22, lineHeight: 1 } as CSSProperties,
  botBubble: { background: 'var(--color-card-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', borderBottomLeftRadius: 'var(--radius-xs)', padding: 'var(--space-3) var(--space-4)', boxShadow: 'var(--shadow-card)', color: 'var(--color-fg)', fontSize: 'var(--text-base)', lineHeight: 'var(--leading-relaxed)', whiteSpace: 'pre-wrap' } as CSSProperties,
  botName: { fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-accent)', marginBottom: 'var(--space-1)' } as CSSProperties,
  noticeAbstain: { background: 'var(--color-bg-subtle)', border: '1px dashed var(--color-border-strong)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', color: 'var(--color-fg-muted)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)' } as CSSProperties,
  noticeError: { background: 'var(--color-warn-bg)', border: '1px solid var(--color-warn)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', color: 'var(--color-warn-fg)', fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)' } as CSSProperties,
  exampleRow: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-4) 0' } as CSSProperties,
  exampleChip: { textAlign: 'left', background: 'var(--color-card-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-full)', padding: 'var(--space-3) var(--space-5)', color: 'var(--color-fg)', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', transition: 'border-color var(--transition-fast), background var(--transition-fast)' } as CSSProperties,
  inputBar: { position: 'sticky', bottom: 0, display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-3) 0', background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' } as CSSProperties,
  input: { flex: 1, padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-base)', borderRadius: 'var(--radius-full)', border: '1.5px solid var(--color-border-strong)', background: 'var(--color-card-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-body)' } as CSSProperties,
  sendBtn: { flexShrink: 0, background: 'var(--color-accent)', color: 'var(--color-accent-fg)', border: 'none', borderRadius: 'var(--radius-full)', padding: '0 var(--space-5)', fontSize: 'var(--text-base)', fontWeight: 700, cursor: 'pointer' } as CSSProperties,
};

// 유사도 → 백분율 라벨
function simPct(s: number) { return `${Math.round(s * 100)}%`; }

function CitationCard({ c }: { c: Citation }) {
  const [open, setOpen] = useState(false);
  const m = sourceMeta(c.source);
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--color-bg-subtle)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-fg)' }}
      >
        <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)', fontWeight: 700, padding: '2px var(--space-2)', borderRadius: 'var(--radius-full)', background: m.bg, color: m.fg }}>
          <span aria-hidden="true">{m.emoji}</span>{m.label}
        </span>
        <span style={{ flex: 1, fontSize: 'var(--text-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || c.doc}</span>
        <span style={{ flexShrink: 0, fontSize: 'var(--text-xs)', color: 'var(--color-fg-subtle)' }}>유사도 {simPct(c.similarity)}</span>
        <span aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-fg-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition-fast)' }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '0 var(--space-3) var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)', lineHeight: 'var(--leading-relaxed)' }}>
          <div style={{ marginBottom: 'var(--space-1)' }}><strong style={{ color: 'var(--color-fg)' }}>문서</strong> {c.doc}</div>
          {c.category && <div style={{ marginBottom: 'var(--space-1)' }}><strong style={{ color: 'var(--color-fg)' }}>분류</strong> {c.category}</div>}
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-subtle)' }}>ref: {c.ref_id}</div>
        </div>
      )}
    </div>
  );
}

function BotMessage({ m }: { m: Msg }) {
  return (
    <div style={S.botRow}>
      <div style={S.avatar} aria-hidden="true">🌱</div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={S.botName}>그득이</div>
        {m.status === 'abstained' ? (
          <div style={S.noticeAbstain}>
            <p style={{ margin: 0, maxWidth: 'none' }}>{m.text}</p>
            <p style={{ margin: 'var(--space-2) 0 0', maxWidth: 'none', fontSize: 'var(--text-xs)' }}>
              다른 표현으로 다시 물어보시거나, 의제·해외사례와 관련된 질문을 해보세요.
            </p>
          </div>
        ) : m.status === 'error' ? (
          <div style={S.noticeError}>
            <p style={{ margin: 0, maxWidth: 'none' }}>{m.text}</p>
          </div>
        ) : (
          <>
            <div style={S.botBubble}>{m.text}</div>
            {m.citations && m.citations.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-fg-muted)', letterSpacing: 'var(--tracking-wide)' }}>
                  근거 자료 {m.citations.length}건
                </div>
                {m.citations.map((c) => <CitationCard key={c.id} c={c} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ChatBot({ defaultSource = null, endpoint = 'chat', k }: ChatBotProps) {
  const [source, setSource] = useState<SourceKey | null>(defaultSource);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  async function ask(query: string) {
    const q = query.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: q }]);
    setLoading(true);

    const push = (m: Msg) => setMessages((prev) => [...prev, m]);
    const sb = getSupabase();
    if (!sb) {
      push({ role: 'bot', status: 'error', text: '지금은 도우미에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.' });
      setLoading(false);
      return;
    }

    try {
      const body: { query: string; source: SourceKey | null; k?: number } = { query: q, source };
      if (k) body.k = k;
      const { data, error } = await sb.functions.invoke(endpoint, { body });
      const res = data as ChatResponse | null;

      if (error || !res) {
        push({ role: 'bot', status: 'error', text: '답변을 가져오는 데 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
      } else if (res.error) {
        // 200-with-error (예: ANTHROPIC_API_KEY 미설정) — 재시도 톤
        push({ role: 'bot', status: 'error', text: '도우미가 잠시 쉬고 있어요. 잠시 후 다시 시도해 주세요.' });
      } else if (res.abstained || res.found === false) {
        // 정직한 동작 — 실패 아님, 차분한 안내
        push({ role: 'bot', status: 'abstained', text: res.answer || '제공된 자료에서 관련 내용을 찾지 못했습니다.' });
      } else {
        push({ role: 'bot', status: 'ok', text: res.answer, citations: res.citations ?? [] });
      }
    } catch {
      push({ role: 'bot', status: 'error', text: '답변을 가져오는 데 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.wrap}>
      <header style={S.header}>
        <h1 style={S.title}>🌱 그득이에게 물어보기</h1>
        <p style={S.sub}>기후시민회의 자료(해외사례·전문가 의제)에서 출처와 함께 찾아드려요.</p>
      </header>

      {/* 소스 필터 */}
      <div role="group" aria-label="자료 출처 필터" style={S.filterRow}>
        {FILTERS.map((f) => {
          const active = source === f.value;
          return (
            <button
              key={f.label}
              type="button"
              onClick={() => setSource(f.value)}
              aria-pressed={active}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-sm)', fontWeight: 700, cursor: 'pointer',
                border: active ? '1.5px solid var(--color-accent)' : '1.5px solid var(--color-border)',
                background: active ? 'var(--color-accent-subtle)' : 'var(--color-card-bg)',
                color: active ? 'var(--color-accent-hover)' : 'var(--color-fg-muted)',
              }}
            >
              <span aria-hidden="true">{f.emoji}</span>{f.label}
            </button>
          );
        })}
      </div>

      {/* 스레드 — aria-live로 새 답변·로딩 안내 */}
      <div style={S.thread} aria-live="polite" aria-busy={loading}>
        {messages.length === 0 && !loading && (
          <div style={S.exampleRow}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)', margin: '0 0 var(--space-1)', maxWidth: 'none' }}>
              이렇게 물어볼 수 있어요
            </p>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => ask(ex)}
                style={S.exampleChip}
              >
                💬 {ex}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user'
            ? <div key={i} style={S.bubbleUser}>{m.text}</div>
            : <BotMessage key={i} m={m} />
        )}

        {loading && (
          <div style={S.botRow}>
            <div style={S.avatar} aria-hidden="true">🌱</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <div style={S.botName}>그득이</div>
              <div style={{ ...S.botBubble, color: 'var(--color-fg-muted)' }}>그득이가 자료를 찾는 중…</div>
            </div>
          </div>
        )}
        <div ref={threadEndRef} />
      </div>

      {/* 입력 바 */}
      <form
        style={S.inputBar}
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
      >
        <label htmlFor="chatbot-input" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          질문 입력
        </label>
        <input
          id="chatbot-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="궁금한 점을 물어보세요…"
          autoComplete="off"
          style={S.input}
        />
        <button type="submit" disabled={loading || !input.trim()} style={{ ...S.sendBtn, opacity: loading || !input.trim() ? 0.5 : 1 }}>
          전송
        </button>
      </form>
    </div>
  );
}
