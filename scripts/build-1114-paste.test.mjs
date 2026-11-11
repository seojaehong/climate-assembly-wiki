import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  AGENDA_COUNTS,
  buildPaste,
  hwpxTitles,
  Paste1114Error,
  pasteFiles,
  readZipEntry,
  TITLE_OVERRIDES,
} from './lib/paste-1114.mjs';
import {
  MAX_STATEMENT_LENGTH,
  parseBulkBallotItems,
  plenaryFormWarnings,
  validateBallotForm,
} from '../src/islands/mod/ballot-panel-logic.ts';
import { plenaryBallotTitle } from '../src/lib/division-ballot-format.ts';

const ROOT = new URL('..', import.meta.url);
const OUT = new URL('../docs/1114-paste/', import.meta.url);
const CLI = new URL('./build-1114-paste.mjs', import.meta.url);
// 원자료(저장소 밖) — 있을 때만 다시 만들어 대조한다. 다른 곳에 두었으면 환경변수로 준다.
const SRC_BASE = 'C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/10_작업산출물';
const SRC_CARDS = process.env.PASTE_1114_CARDS ?? `${SRC_BASE}/2026-11-10_세리머니_국가행사급/data/cards_1114.json`;
const SRC_HWPX = process.env.PASTE_1114_HWPX ?? `${SRC_BASE}/2026-11-09_권고안_확정제목_수정/20261109-권고안_확정_제목_v3.hwpx`;
const haveSources = existsSync(SRC_CARDS) && existsSync(SRC_HWPX);

// ── 시험용 zip(hwpx) 만들기 ────────────────────────────────────────
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.from(e.data, 'utf8');
    const body = e.deflate ? deflateRawSync(data) : data;
    const method = e.deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function sectionXml(pairs) {
  const para = (t) => `<hp:p id="0"><hp:run charPrIDRef="1"><hp:t>${t}</hp:t></hp:run></hp:p>`;
  return `<?xml version="1.0" encoding="UTF-8"?><hs:sec><hp:p id="0"><hp:run><hp:t/></hp:run></hp:p>${pairs
    .map(([no, title]) => para(no) + para(title))
    .join('')}</hs:sec>`;
}

function fakeCards() {
  const out = [];
  for (const [d, n] of Object.entries(AGENDA_COUNTS)) {
    for (let i = 1; i <= n; i += 1) out.push({ no: `${d}-${i}`, division: Number(d), title: `권고 ${d}-${i} 제목을 마련한다.` });
  }
  return out;
}

function fakeV3(cards, edit = {}) {
  const v3 = Object.fromEntries(cards.map((c) => [c.no, c.title]));
  return { ...v3, ...edit };
}

function readCommitted(name) {
  return readFileSync(new URL(name, OUT), 'utf8');
}

// ── 순수 함수 ─────────────────────────────────────────────────────
describe('zip · hwpx 읽기', () => {
  it('저장(0) · 압축(8) 항목을 모두 읽는다, 없는 이름은 오류', () => {
    const zip = makeZip([
      { name: 'mimetype', data: 'application/hwp+zip' },
      { name: 'Contents/section0.xml', data: '<가나다/>', deflate: true },
    ]);
    expect(readZipEntry(zip, 'mimetype').toString('utf8')).toBe('application/hwp+zip');
    expect(readZipEntry(zip, 'Contents/section0.xml').toString('utf8')).toBe('<가나다/>');
    expect(() => readZipEntry(zip, 'Contents/section1.xml')).toThrow(/section1\.xml/);
  });
  it('번호 문단(N-M) 다음 문단이 제목 · 빈 <hp:t/> 무시 · 엔티티 풀기', () => {
    const xml = sectionXml([
      ['1-1', '첫 제목'],
      ['1-2', '공실·유휴건축물 &amp; 신규'],
      ['2-10', '둘째 의제 열 번째'],
    ]);
    expect(hwpxTitles(xml)).toEqual({ '1-1': '첫 제목', '1-2': '공실·유휴건축물 & 신규', '2-10': '둘째 의제 열 번째' });
  });
});

describe('붙여넣기 묶음 만들기', () => {
  it('의제별 19·28·23줄, 「N-M-안1 제목」, 제목은 v3, cards 와 다른 번호를 적는다', () => {
    const cards = fakeCards();
    const v3 = fakeV3(cards, { '1-3': '바뀐 제목 1-3', '3-19': '바뀐 제목 3-19' });
    const { agendas, differsFromCards } = buildPaste(cards, v3);
    expect([agendas[1].length, agendas[2].length, agendas[3].length]).toEqual([19, 28, 23]);
    expect(agendas[1][0]).toBe('1-1-안1 권고 1-1 제목을 마련한다.');
    expect(agendas[1][2]).toBe('1-3-안1 바뀐 제목 1-3');
    expect(agendas[3][18]).toBe('3-19-안1 바뀐 제목 3-19');
    expect(differsFromCards).toEqual([
      { no: '1-3', cards: '권고 1-3 제목을 마련한다.', v3: '바뀐 제목 1-3' },
      { no: '3-19', cards: '권고 3-19 제목을 마련한다.', v3: '바뀐 제목 3-19' },
    ]);
  });
  it('막는 경우 — v3 에 번호 없음 · v3 에만 있는 번호 · 건수 · 순서 · 300자 초과 · 줄바꿈', () => {
    const cards = fakeCards();
    const fail = (c, v) => {
      try {
        buildPaste(c, v);
      } catch (e) {
        expect(e).toBeInstanceOf(Paste1114Error);
        return e.problems.join('\n');
      }
      throw new Error('막지 않았다');
    };
    const v3 = fakeV3(cards);
    const { ['2-7']: _gone, ...noTwoSeven } = v3;
    expect(fail(cards, noTwoSeven)).toMatch(/2-7.*v3 에 없음/);
    expect(fail(cards, { ...v3, '3-24': '덤' })).toMatch(/3-24.*cards 에 없음/);
    expect(fail(cards.filter((c) => c.no !== '1-19'), v3)).toMatch(/의제1: 18건.*19건/);
    const swapped = [...cards];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(fail(swapped, v3)).toMatch(/순서/);
    expect(fail(cards, { ...v3, '2-1': '가'.repeat(300) })).toMatch(/2-1.*300자/);
    expect(fail(cards, { ...v3, '1-5': '두 줄\n제목' })).toMatch(/1-5.*줄바꿈/);
    expect(fail(cards.map((c) => (c.no === '2-2' ? { ...c, division: 3 } : c)), v3)).toMatch(/2-2.*division/);
  });
});

// ── 저장소에 올린 붙여넣기 파일 ──────────────────────────────────────
describe('docs/1114-paste — 폼 점검을 그대로 통과한다', () => {
  for (const [agendaNo, count] of [
    [1, 19],
    [2, 28],
    [3, 23],
  ]) {
    it(`의제${agendaNo}: ${count}건 · 번호 모양 · 의제 번호 · 300자 · 필수`, () => {
      const text = readCommitted(`agenda${agendaNo}.txt`);
      const items = parseBulkBallotItems(text, { optional: false });
      expect(items).toHaveLength(count);
      const title = plenaryBallotTitle(agendaNo);
      expect(plenaryFormWarnings(title, null, items)).toEqual([]);
      const form = validateBallotForm(title, items);
      expect(form.ok).toBe(true);
      expect(form.ok && form.items.every((it) => it.required === true && it.scale === 2)).toBe(true);
      items.forEach((it, i) => {
        expect(it.statement.startsWith(`${agendaNo}-${i + 1}-안1 `)).toBe(true);
        expect(it.statement.length).toBeLessThanOrEqual(MAX_STATEMENT_LENGTH);
      });
      expect(text.startsWith('\uFEFF')).toBe(false);
    });
  }
  it('확정 제목 v3 고정 — cards 와 달랐던 4건 + 11/9 수정 4건(글자 그대로)', () => {
    const all = [1, 2, 3].flatMap((n) => readCommitted(`agenda${n}.txt`).split(/\r?\n/).filter(Boolean));
    const byNo = Object.fromEntries(all.map((l) => [l.slice(0, l.indexOf('-안1 ')), l.slice(l.indexOf('-안1 ') + 4)]));
    expect(byNo['1-3']).toBe('지방자치단체가 공실·유휴건축물을 우선 활용해 불필요한 신규건축을 줄이고, 탄소를 감축하는 제도를 마련해야 한다.');
    expect(byNo['1-13']).toBe('지역별 감축 잠재력을 활용한 탄소감축 지원체계를 구축한다');
    expect(byNo['3-6']).toBe('기후위기 팝업스토어를 운영한다.');
    expect(byNo['3-19']).toBe('정부와 지자체는 교육기관장이 기후위기 교육을 실시할 수 있도록 구체적인 여건을 조성한다');
    expect(byNo['2-1']).toBe('정부와 기업이 협력하여 다회용기 순환 체계를 확대한다.');
    expect(byNo['2-5']).toBe('친환경 소비문화 정착을 위한 법·제도를 마련하고 실천 여건을 개선한다.');
    expect(byNo['2-20']).toBe('개인정보 파기에 대한 신뢰를 높여 폐휴대전화 반납과 자원순환을 촉진한다.');
    expect(byNo['2-21']).toBe('전자제품의 수리와 장기 사용을 지원하여 폐기물 발생을 줄인다.');
    const src = JSON.parse(readCommitted('sources.json'));
    expect(src.differs_from_cards.map((d) => d.no)).toEqual(['1-3', '1-5', '1-7', '1-13', '3-6', '3-19']);
    expect(src.counts).toEqual({ 1: 19, 2: 28, 3: 23 });
    // 11/11 주최 결정 — 1-5 · 1-7 은 권고카드_1109.pdf 문구, 1-3 은 v3(「을」 있음) 그대로
    expect(src.overrides.map((o) => o.no)).toEqual(['1-5', '1-7']);
    expect(byNo['1-5']).toBe('제품별 기준 세분화를 통한 저탄소 인증제도의 강화 및 탄소배출량 공개 의무화한다.');
    expect(byNo['1-7']).toBe('탄소발자국 제도 구체화와 소비자 포인트, 캐시백을 통한 기업의 저탄소 전환을 촉진한다.');
    expect(byNo['1-3']).toBe('지방자치단체가 공실·유휴건축물을 우선 활용해 불필요한 신규건축을 줄이고, 탄소를 감축하는 제도를 마련해야 한다.');
  });
});

// ── 원자료에서 다시 만들어 대조(원자료가 있을 때만) ──────────────────
describe.skipIf(!haveSources)('원자료(cards_1114.json · v3 hwpx)에서 다시 만들면 저장소 파일과 같다', () => {
  it('v3 와 70건 글자 일치(덮어쓴 1-5 · 1-7 제외) · cards 와는 정확히 4건만 다르다 · 파일 그대로', () => {
    const cardsBuf = readFileSync(SRC_CARDS);
    const hwpxBuf = readFileSync(SRC_HWPX);
    const cards = JSON.parse(cardsBuf.toString('utf8'));
    const v3 = hwpxTitles(readZipEntry(hwpxBuf, 'Contents/section0.xml').toString('utf8'));
    expect(Object.keys(v3)).toHaveLength(70);
    const { agendas, differsFromCards } = buildPaste(cards, v3);
    for (const line of Object.values(agendas).flat()) {
      const no = line.slice(0, line.indexOf('-안1 '));
      expect(line.slice(no.length + 4)).toBe(v3[no].trim());
    }
    expect(differsFromCards.map((d) => d.no)).toEqual(['1-3', '1-13', '3-6', '3-19']);
    // 덮어쓰기를 얹으면 그 두 줄만 바뀐다
    const withO = buildPaste(cards, v3, TITLE_OVERRIDES).agendas;
    const changed = Object.values(withO).flat().filter((l, i) => l !== Object.values(agendas).flat()[i]);
    expect(changed.map((l) => l.slice(0, l.indexOf('-안1')))).toEqual(['1-5', '1-7']);
    const files = pasteFiles({ cardsBuf, hwpxBuf, cardsName: 'cards_1114.json', hwpxName: '20261109-권고안_확정_제목_v3.hwpx' });
    for (const [name, text] of Object.entries(files)) expect(readCommitted(name).replace(/\r\n/g, '\n')).toBe(text);
  });
  it('CLI — 같은 파일 4개를 쓰고 rc 0', () => {
    const out = mkdtempSync(join(tmpdir(), 'paste1114-'));
    const r = spawnSync(process.execPath, [CLI.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--cards', SRC_CARDS, '--hwpx', SRC_HWPX, '--out', out], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['agenda1.txt', 'agenda2.txt', 'agenda3.txt', 'sources.json']);
    for (const name of readdirSync(out)) expect(readFileSync(join(out, name), 'utf8')).toBe(readCommitted(name).replace(/\r\n/g, '\n'));
  });
});

describe('CLI — 막히면 rc 2 · 파일을 쓰지 않는다', () => {
  it('v3 에 번호가 빠진 hwpx', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paste1114-bad-'));
    const cards = fakeCards();
    const pairs = cards.filter((c) => c.no !== '2-28').map((c) => [c.no, c.title]);
    writeFileSync(join(dir, 'cards.json'), JSON.stringify(cards));
    writeFileSync(join(dir, 'v3.hwpx'), makeZip([{ name: 'Contents/section0.xml', data: sectionXml(pairs), deflate: true }]));
    const out = join(dir, 'out');
    const r = spawnSync(
      process.execPath,
      [CLI.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--cards', join(dir, 'cards.json'), '--hwpx', join(dir, 'v3.hwpx'), '--out', out],
      { cwd: ROOT, encoding: 'utf8' },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/2-28.*v3 에 없음/);
    expect(existsSync(out)).toBe(false);
  });
});
