import { describe, expect, it } from 'vitest';
import { ATTENDANCE_GUIDE } from './attendance-guide';

/**
 * 안내문은 **화면이 실제로 하는 일**과 어긋나면 안 된다. 어긋난 안내는 없느니만 못하다
 * — 「출석부 잠금」이라는 이름 하나가 「한 번 누르면 못 고치나」를 만들었다.
 */
describe('출석 체크 사용 안내', () => {
  it('빠짐없이 채워져 있다', () => {
    expect(ATTENDANCE_GUIDE.length).toBeGreaterThanOrEqual(6);
    for (const item of ATTENDANCE_GUIDE) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.body.trim().length).toBeGreaterThan(10);
    }
  });

  it('네 가지 상태를 모두 알려 준다', () => {
    const all = ATTENDANCE_GUIDE.map((i) => `${i.title} ${i.body}`).join(' ');
    for (const word of ['출석', '지각', '결석', '조퇴']) expect(all).toContain(word);
  });

  it('★ 되돌리는 법을 알려 준다 — 사용자가 가장 먼저 물은 것', () => {
    const all = ATTENDANCE_GUIDE.map((i) => `${i.title} ${i.body}`).join(' ');
    expect(all).toContain('미확인');
  });

  it('★ 「닫기」가 잠금이 아니라는 것을 밝힌다', () => {
    const item = ATTENDANCE_GUIDE.find((i) => i.title.includes('닫기'));
    expect(item).toBeDefined();
    expect(item!.body).toContain('다시');
    // 「잠긴다」고 오해할 표현이 남아 있으면 안 된다.
    expect(item!.body).not.toContain('잠깁니다');
  });

  // 조원 「비활성화」 버튼을 화면에서 뺐다(2026-08-29). 없앤 기능은 어디로 가야 하는지
  // 안내가 대신 말해야 한다 — 아니면 현장에서 찾다가 시간을 쓴다.
  it('★ 명단에서 내리는 일은 본부 몫이라는 것을 밝힌다', () => {
    const all = ATTENDANCE_GUIDE.map((i) => `${i.title} ${i.body}`).join(' ');
    expect(all).toContain('본부');
    expect(all).toContain('결석');
  });

  it('저장 버튼이 없다는 것을 밝힌다 — 누르면 바로 저장된다', () => {
    const all = ATTENDANCE_GUIDE.map((i) => `${i.title} ${i.body}`).join(' ');
    expect(all).toContain('저장');
  });
});
