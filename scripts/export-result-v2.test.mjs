// 결과 내보내기 명령 — 실전 모양(19 · 28 · 23건, 재적 204 · 출석 160, 가상 이름)으로 파일 만들기 · 검사 · 거부.
import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(import.meta.dirname, 'export-result-v2.mjs');
const COUNTS = { 1: 19, 2: 28, 3: 23 };

function fixture({ confirmedAll = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'result-v2-'));
  mkdirSync(join(dir, 'raw'));
  const roster = Array.from({ length: 204 }, (_, i) => ({ team: `${(i % 3) + 1}분과 ${(i % 15) + 1}조`, no: i + 1, name: `가상${i + 1}` }));
  for (const [a, count] of Object.entries(COUNTS)) {
    const items = Array.from({ length: count }, (_, k) => ({ id: `i-${a}-${k + 1}`, ordinal: k + 1, statement: `${a}-${k + 1}-안1 가상 권고 ${k + 1}`, scale: 2 }));
    // 150명 제출. 마지막 건은 찬성 100(부결), 나머지는 찬성 140. 뺄 표 2장(이름 없음 · 명단 밖).
    const responses = Array.from({ length: 150 }, (_, v) => ({
      id: `r-${a}-${v}`,
      voter_team: roster[v].team,
      voter_name: roster[v].name,
      voter_in_roster: true,
      answers: Object.fromEntries(items.map((it, k) => [it.id, k === count - 1 ? (v < 100 ? 2 : 1) : v < 140 ? 2 : 1])),
      submitted_at: `2026-11-14T05:${String(10 + (v % 40)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}Z`,
    }));
    responses.push({ id: `x-${a}-1`, voter_team: null, voter_name: null, voter_in_roster: null, answers: { [items[0].id]: 2 }, submitted_at: '2026-11-14T05:59:00Z' });
    responses.push({ id: `x-${a}-2`, voter_team: '1분과 1조', voter_name: '명단밖', voter_in_roster: false, answers: { [items[0].id]: 2 }, submitted_at: '2026-11-14T05:59:01Z' });
    writeFileSync(join(dir, 'raw', `agenda${a}.json`), JSON.stringify({ id: `ballot-${a}`, title: `${a}분과 의결`, status: 'closed', subgroup: `${a}분과`, items, roster, responses }));
  }
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
      confirmed: confirmedAll || a !== '3',
      signer: confirmedAll || a !== '3' ? '검증자' : null,
      confirmed_at: confirmedAll || a !== '3' ? '2026-11-14T14:48:00+09:00' : null,
    })),
  };
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
    // 1-1: 휴대폰 140 + 서면 3 = 143 찬성, 반대 10, 기권 7. 뺀 표 2장은 들어가지 않는다.
    expect(doc.items.find((i) => i.no === '1-1')).toMatchObject({ yes: 143, nay: 10, abstain: 7, verdict: '가결' });
    expect(doc.items.find((i) => i.no === '2-28')).toMatchObject({ yes: 100, nay: 50, abstain: 10, verdict: '부결' });
    expect(doc.agendas[0]).toMatchObject({ threshold: 107, established: true });
    const side = readFileSync(join(out, 'result_v2.json.sha256'), 'utf8');
    expect(side.split(/\s+/)[0]).toBe(createHash('sha256').update(buf).digest('hex'));
    const txt = readFileSync(join(out, 'result_v2_요약.txt'), 'utf8');
    expect(txt).toMatch(/부결 1건: 1-19/);
    expect(txt).toMatch(/이름 없음 1 · 명단 밖 1/);
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

