// 결과 내보내기 명령 — 실전 모양(19 · 28 · 23건, 재적 204 · 출석 160, 가상 이름)으로 파일 만들기 · 검사 · 거부.
import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, 'export-result-v2.mjs');
const COUNTS = { 1: 19, 2: 28, 3: 23 };

/**
 * 실전 모양 원자료 3장. 150명 제출(마지막 건 찬성 100 = 부결, 나머지 찬성 140) + 덧붙인 2장:
 * 이름 없음(뺀다) · 직접 입력 전 건 반대(출석부에 있으니 센다, 11/10 결정 + 방어선 B①).
 * 출석부 = 투표한 명단 150 + 직접 입력 1 + 투표하지 않은 명단 9 = 160(= 출석).
 * edit(raw, a) 로 원자료를, cfgEdit(config) 로 설정을 고친다(고의 결함 시험).
 */
function fixture({ confirmedAll = true, attendance = true, edit = null, cfgEdit = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'result-v2-'));
  mkdirSync(join(dir, 'raw'));
  const roster = Array.from({ length: 204 }, (_, i) => ({ team: `${(i % 3) + 1}분과 ${(i % 15) + 1}조`, no: i + 1, name: `가상${i + 1}` }));
  for (const [a, count] of Object.entries(COUNTS)) {
    // required 는 내보내기가 ballot_get 으로 채워 raw 에 저장하는 칸(11/10 C).
    const items = Array.from({ length: count }, (_, k) => ({ id: `i-${a}-${k + 1}`, ordinal: k + 1, statement: `${a}-${k + 1}-안1 가상 권고 ${k + 1}`, scale: 2, required: true }));
    const responses = Array.from({ length: 150 }, (_, v) => ({
      id: `r-${a}-${v}`,
      voter_team: roster[v].team,
      voter_name: roster[v].name,
      voter_in_roster: true,
      answers: Object.fromEntries(items.map((it, k) => [it.id, k === count - 1 ? (v < 100 ? 2 : 1) : v < 140 ? 2 : 1])),
      submitted_at: `2026-11-14T05:${String(10 + (v % 40)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}Z`,
    }));
    responses.push({ id: `x-${a}-1`, voter_team: null, voter_name: null, voter_in_roster: null, answers: Object.fromEntries(items.map((it) => [it.id, 2])), submitted_at: '2026-11-14T05:59:00Z' });
    responses.push({ id: `x-${a}-2`, voter_team: '2분과 3조', voter_name: '직접입력', voter_in_roster: false, answers: Object.fromEntries(items.map((it) => [it.id, 1])), submitted_at: '2026-11-14T05:59:01Z' });
    const raw = { id: `ballot-${a}`, title: `전체회의 의결 의제${a}`, status: 'closed', subgroup: null, items, roster, responses };
    if (edit) edit(raw, Number(a));
    writeFileSync(join(dir, 'raw', `agenda${a}.json`), JSON.stringify(raw));
  }
  const attend = [...roster.slice(0, 159).map(({ team, name }) => ({ team, name })), { team: '2분과 3조', name: '직접입력' }];
  writeFileSync(join(dir, 'attend.json'), JSON.stringify(attend));
  const config = {
    rehearsal: false,
    example: false,
    enrolled: 204,
    report: { mode: 'present_only' },
    agendas: Object.entries(COUNTS).map(([a, count]) => ({
      no: Number(a),
      name: `가상 의제 ${a}`,
      count,
      ballot_id: `ballot-${a}`,
      present: 160,
      method: '휴대폰+서면',
      paper_file: `paper${a}.json`,
      ...(attendance ? { attendance_file: 'attend.json' } : {}),
      confirmed: confirmedAll || a !== '3',
      signer: confirmedAll || a !== '3' ? '검증자' : null,
      confirmed_at: confirmedAll || a !== '3' ? '2026-11-14T14:48:00+09:00' : null,
    })),
  };
  if (cfgEdit) cfgEdit(config);
  for (const a of Object.keys(COUNTS)) writeFileSync(join(dir, `paper${a}.json`), JSON.stringify({ ballots: 3, items: { [`${a}-1`]: { yes: 3 } } }));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return { dir, config };
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('export-result-v2 명령', () => {
  test('실전 모양 3장 → result_v2.json · .sha256 · 요약, 1분 안에, --verify 통과', () => {
    const { dir } = fixture();
    const out = join(dir, 'out');
    const t = Date.now();
    const r = run(['--config', join(dir, 'config.json'), '--out', out, '--source', 'file', '--raw-dir', join(dir, 'raw'), '--now', '2026-11-14T16:05:00+09:00']);
    const ms = Date.now() - t;
    expect(r.status, r.stderr).toBe(0);
    expect(ms).toBeLessThan(60000);
    const buf = readFileSync(join(out, 'result_v2.json'));
    const doc = JSON.parse(buf.toString('utf8'));
    expect(doc.summary).toEqual({ total: 70, passed: 67, failed: 3, not_established: 0, pending: 0 });
    // 1-1: 휴대폰 140 + 서면 3 = 143 찬성, 반대 10 + 직접 입력 1(출석부에 있음) = 11, 기권 6. 이름 없음 1장은 들어가지 않는다.
    expect(doc.items.find((i) => i.no === '1-1')).toMatchObject({ yes: 143, nay: 11, abstain: 6, verdict: '가결' });
    expect(doc.items.find((i) => i.no === '2-28')).toMatchObject({ yes: 100, nay: 51, abstain: 9, verdict: '부결' });
    expect(doc.agendas[0]).toMatchObject({ threshold: 107, established: true });
    const side = readFileSync(join(out, 'result_v2.json.sha256'), 'utf8');
    expect(side.split(/\s+/)[0]).toBe(createHash('sha256').update(buf).digest('hex'));
    const txt = readFileSync(join(out, 'result_v2_요약.txt'), 'utf8');
    expect(txt).toMatch(/부결 1건: 1-19/);
    expect(txt).toMatch(/휴대폰 제출 152 → 유효 151 · 뺀 표 1 \(이름 없음 1\)/);
    expect(txt).toMatch(/직접 입력\(명단에 없는 조·이름\) 1건 — 유효 1 · 검증자 확인 목록 0\(집계 제외\)/);
    expect(txt).toContain('    - 유효: 2분과 3조 직접입력 · 2026-11-14T05:59:01Z');
    expect(txt).not.toMatch(/명단 밖|미응답/);
    expect(txt).toMatch(/합계 70건 — 가결 67 · 부결 3/);
    expect(run(['--verify', join(out, 'result_v2.json')]).status).toBe(0);
  });

  test('파일을 한 글자라도 바꾸면 --verify 실패(sha256)', () => {
    const { dir } = fixture();
    const out = join(dir, 'out');
    expect(run(['--config', join(dir, 'config.json'), '--out', out, '--source', 'file', '--raw-dir', join(dir, 'raw')]).status).toBe(0);
    const f = join(out, 'result_v2.json');
    writeFileSync(f, readFileSync(f, 'utf8').replace('"가결"', '"부결"'));
    const v = run(['--verify', f]);
    expect(v.status).not.toBe(0);
    expect(v.stderr).toMatch(/sha256|재계산/);
  });

  test('의제 하나만 확정 안 됨 → 「일부 확정」 파일(그 의제 표수 null)', () => {
    const { dir } = fixture({ confirmedAll: false });
    const out = join(dir, 'out');
    expect(run(['--config', join(dir, 'config.json'), '--out', out, '--source', 'file', '--raw-dir', join(dir, 'raw')]).status).toBe(0);
    const doc = JSON.parse(readFileSync(join(out, 'result_v2.json'), 'utf8'));
    expect(doc.status).toBe('일부 확정');
    expect(doc.items.filter((i) => i.agenda === 3).every((i) => i.yes === null && i.verdict === '미확정')).toBe(true);
  });

  test('검사 실패(확정인데 서명 없음 · 출석 > 재적)면 종료 코드 2, 파일 없음', () => {
    const { dir, config } = fixture();
    config.agendas[0].signer = '';
    config.agendas[1].present = 205;
    writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
    const out = join(dir, 'out');
    const r = run(['--config', join(dir, 'config.json'), '--out', out, '--source', 'file', '--raw-dir', join(dir, 'raw')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/서명/);
    expect(r.stderr).toMatch(/재적/);
    expect(existsSync(join(out, 'result_v2.json'))).toBe(false);
  });

  const exportFile = (dir, out) => run(['--config', join(dir, 'config.json'), '--out', out, '--source', 'file', '--raw-dir', join(dir, 'raw')]);

  test('(C) 「누르지 않은 건 허용」 문항이 남은 투표지 · 필수 표시를 읽지 못한 원자료면 종료 코드 2, 파일 없음', () => {
    const optional = fixture({ edit: (raw, a) => { if (a === 2) raw.items[4].required = false; } });
    const r1 = exportFile(optional.dir, join(optional.dir, 'out'));
    expect(r1.status).toBe(2);
    expect(r1.stderr).toMatch(/의제 2: 필수가 아닌 문항 1건\(2-5\)/);
    expect(existsSync(join(optional.dir, 'out', 'result_v2.json'))).toBe(false);
    const unknown = fixture({ edit: (raw) => { for (const it of raw.items) delete it.required; } });
    const r2 = exportFile(unknown.dir, join(unknown.dir, 'out'));
    expect(r2.status).toBe(2);
    expect(r2.stderr).toMatch(/필수 표시\(required\)를 읽지 못한 문항 19건/);
  });

  test('(C) 누르지 않은 건이 있는 응답이 들어오면 조용히 빼지 않고 종료 코드 2 — 그 응답을 적는다', () => {
    const { dir } = fixture({
      edit: (raw, a) => {
        if (a === 3) delete raw.responses[7].answers['i-3-23'];
      },
    });
    const r = exportFile(dir, join(dir, 'out'));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/의제 3: 누르지 않은 건이 있는 응답 1건/);
    expect(r.stderr).toMatch(/가상8 · .* · 누르지 않은 건 1건\(3-23\)/);
    expect(existsSync(join(dir, 'out', 'result_v2.json'))).toBe(false);
  });

  test('(B③ 고의 결함) 지어낸 이름 30개로 직접 입력 — 출석부와 안 맞으면 세지 않고 검증자 확인 목록에 적는다', () => {
    const fakes = (raw) =>
      Array.from({ length: 30 }, (_, i) => ({
        id: `f-${raw.id}-${i}`,
        voter_team: `${(i % 3) + 1}분과 ${(i % 15) + 1}조`,
        voter_name: `지어낸${i + 1}`,
        voter_in_roster: false,
        answers: Object.fromEntries(raw.items.map((it) => [it.id, 2])),
        submitted_at: `2026-11-14T06:${String(i).padStart(2, '0')}:00Z`,
      }));
    const { dir } = fixture({ edit: (raw) => raw.responses.push(...fakes(raw)) });
    const out = join(dir, 'out');
    const r = exportFile(dir, out);
    expect(r.status, r.stderr).toBe(0);
    const doc = JSON.parse(readFileSync(join(out, 'result_v2.json'), 'utf8'));
    // 지어낸 30표(전 건 찬성)가 들어갔다면 2-28 은 가결로 뒤집힌다 — 그대로 부결 100표.
    expect(doc.items.find((i) => i.no === '2-28')).toMatchObject({ yes: 100, nay: 51, verdict: '부결' });
    const txt = readFileSync(join(out, 'result_v2_요약.txt'), 'utf8');
    expect(txt).toMatch(/직접 입력\(명단에 없는 조·이름\) 31건 — 유효 1 · 검증자 확인 목록 30\(집계 제외\)/);
    expect(txt).toMatch(/    - 확인 목록: 1분과 1조 지어낸1 · 2026-11-14T06:00:00Z · 출석부 없음/);
  });

  test('(B③ 고의 결함) 출석부까지 지어낸 이름을 받아 유효표가 출석을 넘으면 종료 코드 2 — 확정 파일을 만들지도 바꾸지도 않는다', () => {
    const fakes = (raw) =>
      Array.from({ length: 30 }, (_, i) => ({
        id: `f-${raw.id}-${i}`,
        voter_team: '3분과 15조',
        voter_name: `지어낸${i + 1}`,
        voter_in_roster: false,
        answers: Object.fromEntries(raw.items.map((it) => [it.id, 2])),
        submitted_at: `2026-11-14T06:${String(i).padStart(2, '0')}:00Z`,
      }));
    const { dir } = fixture({ edit: (raw) => raw.responses.push(...fakes(raw)) });
    const attend = JSON.parse(readFileSync(join(dir, 'attend.json'), 'utf8'));
    attend.push(...Array.from({ length: 30 }, (_, i) => ({ team: '3분과 15조', name: `지어낸${i + 1}` })));
    writeFileSync(join(dir, 'attend.json'), JSON.stringify(attend));
    const out = join(dir, 'out');
    mkdirSync(out);
    writeFileSync(join(out, 'result_v2.json'), 'earlier');
    const r = exportFile(dir, out);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/휴대폰 유효표 181 \+ 서면 3 > 출석 160/);
    expect(readFileSync(join(out, 'result_v2.json'), 'utf8')).toBe('earlier');
  });

  test('출력 폴더가 저장소 안(.tmp 밖)이면 거부 — 실명 원자료를 공개 저장소에 두지 않는다', () => {
    const { dir } = fixture();
    const r = run(['--config', join(dir, 'config.json'), '--out', join(import.meta.dirname, 'out-x'), '--source', 'file', '--raw-dir', join(dir, 'raw')]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/저장소 안/);
  });

  test('토큰 없이 rpc 로 읽으려 하면 거부(로그인하지 않는다)', () => {
    const { dir } = fixture();
    const r = spawnSync(process.execPath, [SCRIPT, '--config', join(dir, 'config.json'), '--out', join(dir, 'o')], {
      encoding: 'utf8',
      env: { ...process.env, CV_ACCESS_TOKEN: '' },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/접속 토큰/);
  });
});

