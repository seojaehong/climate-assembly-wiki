import { describe, expect, it } from 'vitest';
import {
  answerLabel,
  displayVoterName,
  inRoster,
  nameGridLayout,
  namedCsvRows,
  normalizeVoterName,
  reconcile,
  responseChoiceText,
  rosterTeams,
  teamShort,
  voterReady,
  voterTag,
  yesNoColumns,
  type NamedResponse,
  type RosterRow,
} from './named-vote-logic';

// 가상 명단(실명 아님).
const roster: RosterRow[] = [
  { team: '1분과 10조', no: 1, name: '가나다' },
  { team: '1분과 2조', no: 2, name: '라마바' },
  { team: '1분과 2조', no: 1, name: '사아자' },
  { team: '1분과 1조', no: 1, name: '차카타' },
  { team: '1분과 1조', no: 2, name: '파 하' },
];

let seq = 0;
function resp(team: string | null, name: string | null, v = 2): NamedResponse {
  seq += 1;
  return {
    id: `r${seq}`,
    voter_team: team,
    voter_name: name,
    voter_in_roster: null,
    answers: { item1: v },
    submitted_at: `2026-10-17T07:${String(seq).padStart(2, '0')}:00Z`,
  };
}

describe('이름 정규화', () => {
  it('대조 키는 공백(전각·NBSP 포함)을 전부 지우고 소문자', () => {
    expect(normalizeVoterName('  홍 길동 ')).toBe('홍길동');
    expect(normalizeVoterName('홍　길 동')).toBe('홍길동');
    expect(normalizeVoterName('가나 (GANA DORA)')).toBe('가나(ganadora)');
    expect(normalizeVoterName(null)).toBe('');
  });
  it('표시용은 원래 모양 — 앞뒤만 떼고 안쪽 공백은 하나로', () => {
    expect(displayVoterName('  가나   (GANA DORA) ')).toBe('가나 (GANA DORA)');
    expect(displayVoterName('홍길동')).toBe('홍길동');
  });
});

describe('명단 접기', () => {
  it('조는 자연 정렬(2조 < 10조), 조 안은 번호순', () => {
    const t = rosterTeams(roster);
    expect(t.map((x) => x.team)).toEqual(['1분과 1조', '1분과 2조', '1분과 10조']);
    expect(t[1].names.map((n) => n.name)).toEqual(['사아자', '라마바']);
    expect(t.map((x) => x.short)).toEqual(['1조', '2조', '10조']);
  });
  it('기획참여단 조 이름 줄임', () => {
    expect(teamShort('기획참여단 분과A')).toBe('분과A');
    expect(teamShort('1분과 3조')).toBe('3조');
    expect(teamShort('단독')).toBe('단독');
  });
  it('인원 보존 — 접어도 사람 수는 그대로', () => {
    expect(rosterTeams(roster).reduce((n, t) => n + t.names.length, 0)).toBe(roster.length);
  });
});

describe('제출 전 검사', () => {
  const teams = rosterTeams(roster);
  it('조·이름 둘 다 있어야 한다', () => {
    expect(voterReady(null, '가나다', teams)).toBe(false);
    expect(voterReady('1분과 1조', '   ', teams)).toBe(false);
    expect(voterReady('1분과 1조', '차카타', teams)).toBe(true);
    expect(voterReady('9분과 9조', '차카타', teams)).toBe(false);
    expect(voterReady('1분과 1조', '가'.repeat(81), teams)).toBe(false);
  });
  it('직접 입력이 명단과 공백만 다르면 명단으로 본다', () => {
    expect(inRoster('1분과 1조', '파하', roster)).toBe(true);
    expect(inRoster('1분과 2조', '파하', roster)).toBe(false);
  });
});

describe('대조', () => {
  it('미제출·명단 밖·같은 이름 두 번·이름 없음을 가른다', () => {
    const responses = [
      resp('1분과 1조', '차카타'),
      resp('1분과 1조', '파하'), // 공백 차이 → 명단과 같은 사람
      resp('1분과 2조', '가나다'), // 명단엔 10조 → 조 다름
      resp('1분과 2조', '없는이'), // 오타 의심
      resp('1분과 2조', '사 아자'),
      resp('1분과 2조', '사아자'), // 같은 이름 두 번
      resp(null, null), // 이름 없는 옛 제출
    ];
    const r = reconcile(roster, responses);
    expect(r.rosterCount).toBe(5);
    expect(r.submitted).toBe(7);
    expect(r.anonymous).toBe(1);
    expect(r.missingCount).toBe(1);
    expect(r.missing).toEqual([{ team: '1분과 2조', short: '2조', names: [{ team: '1분과 2조', no: 2, name: '라마바' }] }]);
    expect(r.offRoster.map((o) => [o.response.voter_name, o.rosterTeam])).toEqual([
      ['가나다', '1분과 10조'],
      ['없는이', null],
    ]);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].key).toBe('사아자');
    expect(r.duplicates[0].responses).toHaveLength(2);
  });
  it('아무도 안 냈으면 명단 전원이 미제출', () => {
    const r = reconcile(roster, []);
    expect(r.missingCount).toBe(roster.length);
    expect(r.offRoster).toEqual([]);
    expect(r.duplicates).toEqual([]);
  });
  it('전원 제출이면 미제출 0', () => {
    const r = reconcile(roster, roster.map((x) => resp(x.team, x.name)));
    expect(r.missingCount).toBe(0);
    expect(r.offRoster).toEqual([]);
  });
});

describe('찬반 라벨·결과 이름표', () => {
  const items = [{ id: 'item1', ordinal: 1, statement: '안', scale: 2 }];
  it('2점: 1=반대, 2=찬성', () => {
    expect(answerLabel(2, 2)).toBe('찬성');
    expect(answerLabel(1, 2)).toBe('반대');
    expect(answerLabel(undefined, 2)).toBe('');
    expect(responseChoiceText({ item1: 2 }, items)).toBe('찬성');
  });
  it('문항이 여럿이면 번호:라벨', () => {
    const two = [...items, { id: 'item2', ordinal: 2, statement: '둘', scale: 5 }];
    expect(responseChoiceText({ item1: 1, item2: 4 }, two)).toBe('1:반대 / 2:4');
  });
  it('이름표는 「3조 홍길동」, 이름 없으면 null', () => {
    expect(voterTag({ voter_team: '1분과 3조', voter_name: ' 홍길동 ' })).toBe('3조 홍길동');
    expect(voterTag({ voter_team: null, voter_name: null })).toBeNull();
  });
  it('찬반 두 단 — 조 → 이름 정렬, 이름 없는 표는 수에만', () => {
    const responses = [
      resp('1분과 10조', '가나다', 2),
      resp('1분과 2조', '사아자', 2),
      resp('1분과 2조', '라마바', 2),
      resp('1분과 1조', '차카타', 1),
      resp(null, null, 1),
    ];
    const c = yesNoColumns(items, responses);
    expect(c).not.toBeNull();
    expect(c!.yes).toBe(3);
    expect(c!.no).toBe(2);
    expect(c!.yesNames).toEqual(['2조 라마바', '2조 사아자', '10조 가나다']);
    expect(c!.noNames).toEqual(['1조 차카타']);
    expect(c!.noAnonymous).toBe(1);
    expect(c!.yesAnonymous).toBe(0);
  });
  it('찬반 문항이 없으면 null', () => {
    expect(yesNoColumns([{ id: 'x', ordinal: 1, statement: '', scale: 5 }], [])).toBeNull();
  });
});

describe('이름표 배치 — 1920×1080 한 화면', () => {
  it('61명도 스크롤 없이 들어간다(단 수 × 줄 수 ≥ 인원, 22px 이상)', () => {
    for (const n of [1, 10, 30, 45, 61, 70]) {
      const { columns, fontPx } = nameGridLayout(n);
      const rows = Math.floor(640 / Math.ceil(fontPx * 1.35));
      expect(rows * columns).toBeGreaterThanOrEqual(n);
      expect(fontPx).toBeGreaterThanOrEqual(22);
    }
  });
  it('적으면 크게', () => {
    expect(nameGridLayout(8).fontPx).toBe(40);
  });
});

describe('실명 CSV', () => {
  it('조·이름·찬반·명단 여부 열, 조 → 이름 순', () => {
    const items = [{ id: 'item1', ordinal: 1, statement: '안', scale: 2 }];
    const a = { ...resp('1분과 2조', '라마바', 1), voter_in_roster: true };
    const b = { ...resp('1분과 1조', '없는이', 2), voter_in_roster: false };
    const c = resp(null, null, 2);
    const rows = namedCsvRows('1분과 의결 1-1', items, [a, b, c]);
    expect(rows.map((r) => r.slice(1, 5))).toEqual([
      ['', '', '찬성', '이름 없음'],
      ['1분과 1조', '없는이', '찬성', '명단에 없음'],
      ['1분과 2조', '라마바', '반대', '명단'],
    ]);
    expect(rows[0][0]).toBe('1분과 의결 1-1');
    // 제출 시각은 서울 시각(UTC+9)
    expect(rows.every((r) => /^2026-10-17 16:\d\d:00$/.test(r[5]))).toBe(true);
  });
});

describe('실명 CSV 글', () => {
  it('BOM·머리행·따옴표·수식 주입 방지', async () => {
    const { namedCsvText } = await import('./named-vote-logic');
    const t = namedCsvText([['a,b', '=1+1', '홍"길동', '찬성', '명단', 'x']]);
    expect(t.startsWith('﻿투표,조,이름,찬반,명단 여부,제출 시각(KST)\r\n')).toBe(true);
    expect(t).toContain('"a,b",\'=1+1,"홍""길동",찬성');
  });
});

describe('서울 시각', () => {
  it('UTC → KST, 날짜 넘김, 못 읽으면 원문', async () => {
    const { kstText } = await import('./named-vote-logic');
    expect(kstText('2026-10-17T07:05:09Z')).toBe('2026-10-17 16:05:09');
    expect(kstText('2026-10-17T15:30:00+00:00')).toBe('2026-10-18 00:30:00');
    expect(kstText('x')).toBe('x');
    expect(kstText(null)).toBe('');
  });
});

describe('같은 이름 규칙', () => {
  it('한 투표 안에서 같은 이름(공백·대소문자 무시)은 조가 달라도 한 번만 — 서버가 대조 키로 거부한다', () => {
    // 명단에 같은 분과 동명이인이 있으면 이 규칙이 그 사람을 막는다. 10/17 명단은 분과 안 동명이인 0(로더 점검과 별도로 확인).
    expect(normalizeVoterName('홍 길동')).toBe(normalizeVoterName('홍길동'));
    const r = reconcile([], [resp('1분과 1조', '홍길동'), resp('1분과 2조', '홍 길동')]);
    expect(r.duplicates).toHaveLength(1);
  });
});

describe('제출자 찾기(정정용)', () => {
  it('이름·조로 찾고, 명단 안의 이름도 나온다(남의 이름을 고른 경우 고치려고)', async () => {
    const { searchResponses } = await import('./named-vote-logic');
    const list = [resp('1분과 2조', '라마바'), resp('1분과 1조', '가나다'), resp('1분과 10조', '사 아자'), resp(null, null)];
    expect(searchResponses(list, '').map((r) => r.voter_name)).toEqual([null, '가나다', '라마바', '사 아자']);
    expect(searchResponses(list, '사아').map((r) => r.voter_name)).toEqual(['사 아자']);
    expect(searchResponses(list, '2조').map((r) => r.voter_name)).toEqual(['라마바']);
    expect(searchResponses(list, '1분과1조가나').map((r) => r.voter_name)).toEqual(['가나다']);
  });
});
