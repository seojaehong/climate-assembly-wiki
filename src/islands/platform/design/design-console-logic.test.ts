import { describe, expect, it } from 'vitest';
import { buildDesignBlueprint, buildDesignView, serializeDesignBlueprint } from './design-console-logic';

describe('buildDesignBlueprint', () => {
  it('공론화·회차·주제·조 정원을 순서가 고정된 비저장 청사진으로 만든다', () => {
    const result = buildDesignBlueprint({
      assemblyTitle: '  기후시민회의  ',
      assemblySlug: 'climate-2026',
      sessions: [{
        heldOn: '2026-08-29',
        topics: ['에너지 전환 조건', '지역 비용 우려'],
        teamCount: 3,
        participantCount: 10,
      }],
    });

    expect(result).toEqual({
      ok: true,
      blueprint: {
        schemaVersion: 1,
        kind: 'platform-design-blueprint',
        dryRun: true,
        databaseMutationExecuted: false,
        requiresApproval: true,
        assembly: { title: '기후시민회의', slug: 'climate-2026' },
        sessions: [{
          ordinal: 1,
          heldOn: '2026-08-29',
          topics: [
            { ordinal: 1, prompt: '에너지 전환 조건' },
            { ordinal: 2, prompt: '지역 비용 우려' },
          ],
          teams: [
            { ordinal: 1, plannedCapacity: 4 },
            { ordinal: 2, plannedCapacity: 3 },
            { ordinal: 3, plannedCapacity: 3 },
          ],
        }],
        stats: { sessionCount: 1, topicCount: 2, teamCount: 3, participantCount: 10 },
      },
    });
  });

  it('공론화 식별정보와 회차가 없으면 적용 가능한 청사진으로 표시하지 않는다', () => {
    expect(buildDesignBlueprint({
      assemblyTitle: '   ',
      assemblySlug: 'Climate 2026',
      sessions: [],
    })).toEqual({
      ok: false,
      errors: [
        '공론화 이름을 입력하세요.',
        'slug는 영문 소문자·숫자·하이픈 3~40자로 입력하세요.',
        '회차를 하나 이상 추가하세요.',
      ],
    });
  });

  it('잘못된 날짜·주제·조·참여자 입력을 회차별 오류로 모아 반환한다', () => {
    expect(buildDesignBlueprint({
      assemblyTitle: '기후시민회의',
      assemblySlug: 'climate-2026',
      sessions: [{
        heldOn: '2026-02-30',
        topics: [' ', '비용 우려', '비용 우려 '],
        teamCount: 0,
        participantCount: -1,
      }],
    })).toEqual({
      ok: false,
      errors: [
        '제1회차 날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력하세요.',
        '제1회차 주제에 빈 항목이 있습니다.',
        '제1회차 주제는 중복될 수 없습니다.',
        '제1회차 조 수는 1~500 범위의 정수여야 합니다.',
        '제1회차 참여자 수는 1~100000 범위의 정수여야 합니다.',
      ],
    });
  });

  it('주제 없는 회차·빈 조 정원·역순 일정을 거부한다', () => {
    expect(buildDesignBlueprint({
      assemblyTitle: '기후시민회의',
      assemblySlug: 'climate-2026',
      sessions: [
        { heldOn: '2026-08-30', topics: [], teamCount: 3, participantCount: 2 },
        { heldOn: '2026-08-29', topics: ['비용 우려'], teamCount: 2, participantCount: 10 },
      ],
    })).toEqual({
      ok: false,
      errors: [
        '제1회차 주제를 하나 이상 입력하세요.',
        '제1회차 참여자 수는 조 수 이상이어야 합니다.',
        '회차 날짜는 앞 회차보다 이르지 않아야 합니다.',
      ],
    });
  });

  it('안전한 처리 범위를 넘는 조와 참여자 수를 청사진 생성 전에 거부한다', () => {
    expect(buildDesignBlueprint({
      assemblyTitle: '기후시민회의',
      assemblySlug: 'climate-2026',
      sessions: [{
        heldOn: '2026-08-29',
        topics: ['비용 우려'],
        teamCount: 501,
        participantCount: Number.MAX_SAFE_INTEGER + 1,
      }],
    })).toEqual({
      ok: false,
      errors: [
        '제1회차 조 수는 1~500 범위의 정수여야 합니다.',
        '제1회차 참여자 수는 1~100000 범위의 정수여야 합니다.',
      ],
    });
  });

  it('회차·주제·전체 생성 항목 예산을 초과하는 청사진을 거부한다', () => {
    const oversizedSessions = Array.from({ length: 25 }, (_, index) => ({
      heldOn: '2026-08-29',
      topics: index === 0 ? Array.from({ length: 51 }, (_, topicIndex) => `주제 ${topicIndex + 1}`) : ['비용 우려'],
      teamCount: 500,
      participantCount: 500,
    }));

    expect(buildDesignBlueprint({
      assemblyTitle: '기후시민회의',
      assemblySlug: 'climate-2026',
      sessions: oversizedSessions,
    })).toEqual({
      ok: false,
      errors: [
        '회차는 최대 24개까지 추가할 수 있습니다.',
        '제1회차 주제는 최대 50개까지 입력할 수 있습니다.',
        '청사진의 주제와 조는 합계 10000개를 넘을 수 없습니다.',
      ],
    });
  });

  it('공론화 이름과 개별 주제의 텍스트 길이를 제한한다', () => {
    expect(buildDesignBlueprint({
      assemblyTitle: '가'.repeat(201),
      assemblySlug: 'climate-2026',
      sessions: [{ heldOn: '2026-08-29', topics: ['나'.repeat(501)], teamCount: 2, participantCount: 10 }],
    })).toEqual({
      ok: false,
      errors: [
        '공론화 이름은 200자 이하여야 합니다.',
        '제1회차 각 주제는 500자 이하여야 합니다.',
      ],
    });
  });

  it('승인 검토용 JSON을 안정된 파일명과 UTF-8 내용으로 직렬화한다', () => {
    const result = buildDesignBlueprint({
      assemblyTitle: '기후시민회의',
      assemblySlug: 'climate-2026',
      sessions: [{ heldOn: '2026-08-29', topics: ['비용 우려'], teamCount: 2, participantCount: 10 }],
    });
    if (!result.ok) throw new Error('Expected a valid blueprint');

    const download = serializeDesignBlueprint(result.blueprint);
    expect(download.filename).toBe('climate-2026_design_blueprint.json');
    expect(download.content.endsWith('\n')).toBe(true);
    expect(JSON.parse(download.content)).toEqual(result.blueprint);
    expect(download.content).toContain('"databaseMutationExecuted": false');
  });
});

describe('buildDesignView', () => {
  it('RPC ok를 준비 완료 정본으로 쓰고 제출 현황은 정보로 분리한다', () => {
    const view = buildDesignView('session', [{
      target: { id: 'session-1', label: '제1차 회의' },
      result: {
        ok: true,
        checks: [
          { key: 'topics_open', pass: true, detail: '2개 주제 open' },
          { key: 'teams_active', pass: false, detail: '0개 조 active' },
          { key: 'roster_loaded', pass: true, detail: '12명 배정' },
          { key: 'submissions', pass: true, detail: '3/4 최종 제출' },
        ],
      },
    }]);

    expect(view.stats).toEqual({ sessionCount: 1, readyCount: 1, blockedCount: 0, gatePassCount: 2, gateCount: 3 });
    expect(view.sessions[0].ready).toBe(true);
    expect(view.sessions[0].checks).toEqual([
      expect.objectContaining({ label: '공개 주제', kind: 'gate', statusLabel: '통과' }),
      expect.objectContaining({ label: '활성 조', kind: 'gate', statusLabel: '확인 필요' }),
      expect.objectContaining({ label: '참여자 배정', kind: 'gate', statusLabel: '통과' }),
      expect.objectContaining({ label: '최종 제출 현황', kind: 'informational', statusLabel: '정보' }),
    ]);
  });

  it('알 수 없는 검사는 안전하게 필수 게이트로 보존한다', () => {
    const view = buildDesignView('assembly', [{
      target: { id: 'session-1', label: '제1차 회의' },
      result: { ok: true, checks: [{ key: 'custom_gate', pass: true, detail: '설정 완료' }] },
    }]);

    expect(view.sessions[0].checks[0]).toMatchObject({ key: 'custom_gate', label: 'custom_gate', kind: 'gate' });
  });
});
