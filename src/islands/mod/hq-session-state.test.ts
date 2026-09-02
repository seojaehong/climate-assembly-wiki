import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hqBoardState, notOpenedMessage } from './hq-session-state';
import { CURRENT_SESSION_SLUG } from '../../lib/hq-submissions';

const base = { rows: [] as unknown[], failed: null as string | null, boardCount: 0, sessionSlug: 'X' };

describe('본부 보드 표시 상태', () => {
  it('첫 응답 전에는 로딩이다 (실패로 읽지 않는다)', () => {
    expect(hqBoardState({ ...base, rows: null }).kind).toBe('loading');
  });

  it('실패 문구가 있으면 로딩보다 실패가 이긴다', () => {
    const state = hqBoardState({ ...base, rows: null, failed: 'PGRST202: 없음' });
    expect(state).toEqual({ kind: 'failed', message: 'PGRST202: 없음' });
  });

  it('꼭지가 하나라도 있으면 정상이다', () => {
    expect(hqBoardState({ ...base, boardCount: 3 }).kind).toBe('ready');
  });

  it('응답은 왔는데 꼭지가 0이면 「개통되지 않았다」로 알린다 — 빈 화면이 아니다', () => {
    const state = hqBoardState({ ...base, sessionSlug: '0912-deliberation' });
    expect(state.kind).toBe('not-opened');
    if (state.kind !== 'not-opened') return;
    expect(state.headline).toContain('개통');
    // 어느 세션을 보고 있는지가 화면에 나와야 한다 — 본부가 회차를 헷갈리면 안 된다.
    expect(state.detail).toContain('0912-deliberation');
    expect(state.sessionSlug).toBe('0912-deliberation');
  });

  it('원인을 하나로 단정하지 않는다 (세션 미개통 · 꼭지 미개방 둘 다 적는다)', () => {
    const { detail } = notOpenedMessage('0912-deliberation');
    expect(detail).toContain('개통 SQL');
    expect(detail).toContain('꼭지');
    expect(detail).toMatch(/구별되지 않습니다/);
  });

  it('지난 회차 산출물이 지워진 것이 아님을 함께 알린다', () => {
    expect(notOpenedMessage('0912-deliberation').hint).toContain('지워지지 않았습니다');
  });
});

describe('활성 세션 상수 — 시드와 화면이 같은 회차를 본다', () => {
  /**
   * 회차를 넘길 때 고치는 곳이 두 군데다 — 접속코드·seed SQL 을 만드는
   * `scripts/session-rosters.mjs` 의 ACTIVE_SESSION_SLUG 와, 본부 화면이 읽는
   * `src/lib/hq-submissions.ts` 의 CURRENT_SESSION_SLUG. **한쪽만 고치면**
   * 조는 새 코드로 들어가는데 본부는 지난 회차를 보게 된다(그 반대도 된다).
   * 값을 박지 않고 **두 파일이 서로 같은지**만 잰다 — 다음 회차에도 이 검사가 유효하다.
   */
  it('scripts/session-rosters.mjs 의 활성 슬러그와 같다', () => {
    const rosters = readFileSync(
      join(import.meta.dirname, '..', '..', '..', 'scripts', 'session-rosters.mjs'),
      'utf8'
    );
    const active = /export const ACTIVE_SESSION_SLUG = '([^']+)'/.exec(rosters)?.[1];
    expect(active, 'ACTIVE_SESSION_SLUG 를 찾지 못했습니다').toBeTruthy();
    expect(CURRENT_SESSION_SLUG).toBe(active);
  });
});
