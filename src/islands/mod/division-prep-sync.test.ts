import { describe, expect, it } from 'vitest';
import {
  CONFLICT_NOTICE,
  canPoll,
  canSave,
  chipText,
  classifyPrepError,
  emptySlot,
  prepByteSize,
  prepTooLarge,
  slotAfterSave,
  slotEdited,
  slotFromRow,
  slotSaveFailed,
  slotSaveStarted,
} from './division-prep-sync';
import { createMotion, initPrepState, serializePrep, type PrepState } from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import type { DivisionPrepRow } from '../../lib/division-prep';

const div2 = DIVISION_VOTE_FIXTURE.find((d) => d.division === 2)!;
const s0 = initPrepState(div2);
function withMotion(title: string): PrepState {
  const r = createMotion(s0, { cardNos: ['2-1-1'], title, text: '' });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}
const row = (version: number, state: unknown, by = '운영팀'): DivisionPrepRow => ({
  subgroup: '2분과',
  version,
  state,
  updated_at: '2026-10-17T05:00:00.000Z',
  updated_by: by,
});

describe('서버 줄 읽기', () => {
  it('서버가 비었으면(version 0) 이 기기 내용을 씨앗으로 올릴 준비를 한다', () => {
    const { slot } = slotFromRow(undefined, row(0, null), s0);
    expect(slot.state).toBe(s0);
    expect(slot.version).toBe(0);
    expect(slot.dirty).toBe(true);
    expect(canSave(slot)).toBe(true);
  });

  it('서버도 이 기기도 비었으면 아무것도 올리지 않는다', () => {
    const { slot } = slotFromRow(undefined, row(0, null), null);
    expect(slot.state).toBeNull();
    expect(canSave(slot)).toBe(false);
  });

  it('서버 내용이 있으면 이 기기 저장소보다 서버가 이긴다', () => {
    const server = withMotion('서버 안');
    const { slot } = slotFromRow(undefined, row(4, JSON.parse(serializePrep(server))), s0);
    expect(slot.state).toEqual(server);
    expect(slot.version).toBe(4);
    expect(slot.dirty).toBe(false);
    expect(slot.updatedBy).toBe('운영팀');
  });

  it('★ 서버 줄을 읽을 수 없으면 저장을 막는다(덮어쓰지 않는다)', () => {
    const { slot, notice } = slotFromRow(undefined, row(3, { v: 99 }), s0);
    expect(slot.unreadable).toBe(true);
    expect(canSave({ ...slot, dirty: true })).toBe(false);
    expect(notice?.tone).toBe('error');
    // 다른 분과 내용이 이 분과 줄에 들어 있어도 읽지 않는다
    const div3 = initPrepState(DIVISION_VOTE_FIXTURE.find((d) => d.division === 3)!);
    expect(slotFromRow(undefined, row(1, JSON.parse(serializePrep(div3))), null).slot.unreadable).toBe(true);
  });

  it('옛 v1 모양 서버 줄도 읽는다', () => {
    const v1 = { v: 1, division: 2, source: div2, cards: s0.cards, motions: [] };
    const { slot } = slotFromRow(undefined, row(2, v1), null);
    expect(slot.state?.v).toBe(2);
    expect(slot.unreadable).toBe(false);
  });

  it('★ 이 기기 고침이 대기 중이거나 저장 중이면 폴링 값을 받지 않는다', () => {
    const mine = slotEdited({ ...emptySlot(s0), version: 2 }, withMotion('내 고침'));
    const server = row(3, JSON.parse(serializePrep(withMotion('남의 고침'))));
    expect(slotFromRow(mine, server, null).slot).toBe(mine);
    const saving = slotSaveStarted({ ...mine, dirty: false });
    expect(slotFromRow(saving, server, null).slot).toBe(saving);
    expect(canPoll({ 2: mine })).toBe(false);
    expect(canPoll({ 2: saving })).toBe(false);
    expect(canPoll({ 2: { ...emptySlot(s0), version: 2 } })).toBe(true);
  });

  it('서버에 올리지 않는 칸(이 기기 전용·읽기 실패)의 고침은 폴링을 막지 않는다', () => {
    const clean = { ...emptySlot(s0), version: 2 };
    const localOnly = slotEdited(emptySlot(s0), withMotion('이 기기 전용'));
    expect(canPoll({ 2: clean, 3: localOnly }, [2])).toBe(true);
    expect(canPoll({ 2: clean, 3: localOnly }, [2, 3])).toBe(false);
    const unreadable = { ...slotEdited(emptySlot(s0), withMotion('x')), unreadable: true };
    expect(canPoll({ 2: clean, 1: unreadable }, [1, 2])).toBe(true);
  });

  it('같은 판번호면 상태 객체를 바꾸지 않는다(화면이 다시 그려지지 않게)', () => {
    const prev = { ...emptySlot(s0), version: 5 };
    const { slot } = slotFromRow(prev, row(5, JSON.parse(serializePrep(s0))), null);
    expect(slot.state).toBe(s0);
  });
});

describe('저장', () => {
  it('성공하면 판번호를 올리고, 보내는 사이 또 고쳤으면 다시 저장할 거리로 남긴다', () => {
    const a = withMotion('a');
    let slot = slotSaveStarted(slotEdited({ ...emptySlot(s0), version: 1 }, a));
    expect(canSave(slot)).toBe(false); // 하나만 나간다
    const ok = slotAfterSave(slot, a, { ok: true, version: 2, updated_at: '2026-10-17T05:01:00.000Z' });
    expect(ok.slot).toMatchObject({ version: 2, dirty: false, saving: false });

    const b = withMotion('b');
    slot = slotSaveStarted(slotEdited({ ...emptySlot(s0), version: 1 }, a));
    slot = slotEdited(slot, b); // 저장 중 추가 고침
    const after = slotAfterSave(slot, a, { ok: true, version: 2, updated_at: 'x' });
    expect(after.slot).toMatchObject({ version: 2, dirty: true, saving: false });
    expect(after.slot.state).toBe(b);
    expect(canSave(after.slot)).toBe(true);
  });

  it('★ 충돌하면 섞지 않고 서버 최신으로 통째로 바꾸고 알린다', () => {
    const mine = withMotion('내 것');
    const theirs = withMotion('남의 것');
    const slot = slotSaveStarted(slotEdited({ ...emptySlot(s0), version: 1 }, mine));
    const { slot: next, notice } = slotAfterSave(slot, mine, {
      ok: false,
      conflict: true,
      current: row(2, JSON.parse(serializePrep(theirs)), '1분과'),
    });
    expect(next.state).toEqual(theirs);
    expect(next.version).toBe(2);
    expect(next.dirty).toBe(false);
    expect(next.updatedBy).toBe('1분과');
    expect(notice).toEqual({ tone: 'warn', text: CONFLICT_NOTICE });
    expect(CONFLICT_NOTICE).toBe('다른 화면에서 먼저 고쳤습니다. 최신 내용으로 바꿨습니다.');
  });

  it('충돌인데 서버 내용을 읽을 수 없으면 저장을 멈춘다', () => {
    const slot = slotSaveStarted(slotEdited({ ...emptySlot(s0), version: 1 }, withMotion('x')));
    const { slot: next, notice } = slotAfterSave(slot, slot.state!, { ok: false, conflict: true, current: row(2, { broken: true }) });
    expect(next.unreadable).toBe(true);
    expect(canSave({ ...next, dirty: true })).toBe(false);
    expect(notice?.tone).toBe('error');
  });

  it('네트워크 실패면 고침을 남기고 다음에 다시 보낸다', () => {
    const slot = slotSaveFailed(slotSaveStarted(slotEdited(emptySlot(s0), withMotion('x'))));
    expect(slot).toMatchObject({ saving: false, dirty: true });
    expect(canSave(slot)).toBe(true);
  });
});

describe('오류 판별 — 이 기기 저장으로 내려갈지', () => {
  it('서버 함수 없음(PGRST202·42883)·네트워크·권한', () => {
    expect(classifyPrepError(new Error('Could not find the function climate_vote.division_prep_get_v1(p_token) in the schema cache'))).toBe('missing');
    expect(classifyPrepError(new Error('function climate_vote.division_prep_get_v1(text) does not exist'))).toBe('missing');
    expect(classifyPrepError(new Error('Supabase client unavailable (missing env)'))).toBe('missing');
    expect(classifyPrepError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyPrepError(new Error('division prep scope unknown for team subgroup'))).toBe('denied');
    expect(classifyPrepError(new Error('division mismatch'))).toBe('denied');
    expect(classifyPrepError('무언가')).toBe('other');
    expect(classifyPrepError(undefined)).toBe('other');
  });
});

describe('크기·상태 칩', () => {
  it('크기 상한(512KB)을 넘으면 저장하지 않는다', () => {
    expect(prepByteSize(s0)).toBeGreaterThan(100);
    expect(prepTooLarge(s0)).toBe(false);
    expect(prepTooLarge(s0, 100)).toBe(true);
  });

  it('칩 문구', () => {
    const saved = { ...emptySlot(s0), version: 2, updatedAt: new Date(2026, 9, 17, 14, 5, 9).toISOString() };
    expect(chipText('server', saved, false)).toEqual({ tone: 'ok', text: '저장됨 14:05:09' });
    expect(chipText('server', { ...saved, dirty: true }, false)).toEqual({ tone: 'busy', text: '저장 중' });
    expect(chipText('server', { ...saved, dirty: true }, true).text).toBe('서버 저장 안 됨');
    expect(chipText('local', saved, false).text).toBe('서버 저장 안 됨');
    expect(chipText('server', { ...saved, unreadable: true }, false).text).toBe('서버 저장 안 됨');
    expect(chipText('connecting', undefined, false).text).toBe('서버 연결 중');
  });
});
