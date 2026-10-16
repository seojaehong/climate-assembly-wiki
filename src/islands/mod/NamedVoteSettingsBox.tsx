import { useCallback, useEffect, useState } from 'react';
import {
  namedVoteSettings,
  setNamedVoteSettings,
  type NamedVoteSettings,
  type WorkshopAuthorization,
} from '../../lib/deliberation';

/**
 * 실명 투표 세션 스위치(s28) — ①휴대폰에서 조·이름 받기 ②큰 화면 「투표결과 보기」에 이름 띄우기.
 * 둘 다 기본 켜짐(10/17 08:05 실명 결정). 명단이 없는 세션은 켜져 있어도 무기명이다. 서버(session.config)에 저장 — 재배포 없이 바뀐다.
 * 이 세션의 모든 운영 화면·발표 창·휴대폰이 같은 값을 쓴다. s28 미적용이면 상자를 그리지 않는다.
 */
export default function NamedVoteSettingsBox({ access }: { access: WorkshopAuthorization | null }) {
  const [s, setS] = useState<NamedVoteSettings | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!access) return;
    try {
      const r = await namedVoteSettings(access);
      if (r === null) setMissing(true);
      else setS(r);
    } catch (e: unknown) {
      console.warn('[named settings] load failed', e);
    }
  }, [access]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  if (!access || missing || !s) return null;

  const toggle = async (key: 'collect' | 'show_names') => {
    const next = !s[key];
    const ask =
      key === 'collect'
        ? next
          ? '휴대폰 투표 화면에서 조·이름을 받습니다(실명). 이미 열린 화면은 새로고침 뒤부터 적용됩니다. 켭니까?'
          : '조·이름 받기를 끕니다. 지금부터 휴대폰 화면은 무기명입니다. 끕니까?'
        : next
          ? '큰 화면 「투표결과 보기」에 찬성·반대한 사람 이름이 보입니다. 켭니까?'
          : '큰 화면에서 이름을 숨기고 수만 보입니다. 끕니까?';
    if (!window.confirm(ask)) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await setNamedVoteSettings(access, { [key]: next });
      setS({ ...s, ...r });
    } catch (e: unknown) {
      console.error('[named settings] save failed', e);
      setErr('바꾸지 못했습니다. 다시 눌러 주십시오.');
    } finally {
      setBusy(false);
    }
  };

  const pill = (on: boolean) =>
    `min-h-12 rounded-xl px-4 text-[17px] font-bold disabled:opacity-40 ${on ? 'bg-[#135C73] text-white' : 'border border-[#C4D8E4] bg-white text-[#1F4E79]'}`;

  return (
    <div data-testid="named-settings" className="rounded-xl border-2 border-[#C4D8E4] bg-[#F5F8FB] px-4 py-3">
      <p className="text-[16px] font-extrabold text-[#1F4E79]">
        실명 투표 설정 <span className="font-bold text-[#5A6B73]">(이 세션 전체 · 명단 {s.roster_count ?? 0}명)</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button type="button" disabled={busy} className={pill(s.collect)} onClick={() => void toggle('collect')} data-testid="named-collect" aria-pressed={s.collect}>
          조·이름 받기: {s.collect ? '켜짐' : '꺼짐(무기명)'}
        </button>
        <button type="button" disabled={busy} className={pill(s.show_names)} onClick={() => void toggle('show_names')} data-testid="named-show" aria-pressed={s.show_names}>
          큰 화면에 이름: {s.show_names ? '켜짐' : '꺼짐(수만)'}
        </button>
      </div>
      {s.collect && (s.roster_count ?? 0) === 0 ? (
        <p className="mt-2 text-[15px] font-bold text-[#B45309]">명단이 비어 있어 휴대폰 화면은 무기명 그대로입니다.</p>
      ) : null}
      {err ? <p className="mt-2 text-[15px] font-bold text-[#B91C1C]">{err}</p> : null}
    </div>
  );
}
