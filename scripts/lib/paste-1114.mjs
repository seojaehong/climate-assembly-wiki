/**
 * 11/14 전체회의 의결 투표지 — 「여러 건 한 번에 붙여넣기」 칸에 넣을 의제별 줄 묶음을 원자료에서 만든다.
 *
 * - 번호 · 의제(분과) 목록 = cards_1114.json(70건, 19·28·23)
 * - 제목 = 11/9 확정 한글본 v3(20261109-권고안_확정_제목_v3.hwpx). 20_투표_최종안 U4 「한글본 기준」 기본값.
 *   cards 와 글자가 다른 번호는 sources.json 의 differs_from_cards 에 적는다(조용히 고르지 않는다).
 * - 줄 모양 = 「N-M-안1 제목」(결과 내보내기 motionNumber · 폼 plenaryFormWarnings 가 읽는 모양).
 * 손으로 쓰지 않는다 — 막히는 경우(번호 누락 · 건수 · 순서 · 300자 초과 · 줄바꿈)는 Paste1114Error 로 전부 적고 아무것도 쓰지 않는다.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const AGENDA_COUNTS = Object.freeze({ 1: 19, 2: 28, 3: 23 });
/** 폼 한계(src/islands/mod/ballot-panel-logic.ts MAX_STATEMENT_LENGTH) — 시험이 두 값을 대조한다. */
export const MAX_LINE = 300;

export class Paste1114Error extends Error {
  constructor(problems) {
    super(`붙여넣기 묶음을 만들지 않음 — ${problems.length}건\n${problems.join('\n')}`);
    this.name = 'Paste1114Error';
    this.problems = problems;
  }
}

/** zip(hwpx) 안 한 항목. 저장(0) · deflate(8)만. 외부 패키지 없이 node:zlib 로. */
export function readZipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 이 아님(끝 레코드 없음)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 목록이 깨짐');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nlen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const body = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(body);
      if (method === 8) return inflateRawSync(body);
      throw new Error(`zip 압축 방식 ${method} 은 읽지 못함 — ${name}`);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`zip 에 ${name} 없음`);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * 확정 제목 한글본(section0.xml) → { 「1-3」: 제목 }. 번호만 있는 문단 다음 문단이 제목이다
 * (기후회의 data/check_cards.py hwpx_titles 와 같은 규칙).
 */
export function hwpxTitles(xml) {
  const texts = [];
  for (const m of xml.matchAll(/<hp:p\b[\s\S]*?<\/hp:p>/g)) {
    const t = [...m[0].matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)]
      .map((x) => x[1])
      .join('')
      .replace(/<[^>]+>/g, '')
      .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
    if (t.trim()) texts.push(t);
  }
  const out = {};
  texts.forEach((t, i) => {
    if (/^[123]-\d{1,2}$/.test(t.trim()) && i + 1 < texts.length) out[t.trim()] = texts[i + 1];
  });
  return out;
}

/** cards(번호 목록) + v3(제목) → 의제별 줄. 막히는 것이 하나라도 있으면 전부 적어 던진다. */
/**
 * v3 위에 덮어쓰는 제목 — 주최 결정으로만 넣는다(번호마다 근거를 적는다).
 * 11/11 주최 결정: 투표 화면에 사무국 권고카드(1109 PDF) 그림을 한 장씩 띄우므로 1-5 · 1-7 은 카드 문구에 맞춘다.
 * (1-3 은 v3 「공실·유휴건축물을」 그대로 두고 카드 그림 쪽에 「을」을 넣었다.)
 */
export const TITLE_OVERRIDES = Object.freeze({
  '1-5': { title: '제품별 기준 세분화를 통한 저탄소 인증제도의 강화 및 탄소배출량 공개 의무화한다.', why: '11/11 주최 결정 — 권고카드_1109.pdf 문구' },
  '1-7': { title: '탄소발자국 제도 구체화와 소비자 포인트, 캐시백을 통한 기업의 저탄소 전환을 촉진한다.', why: '11/11 주최 결정 — 권고카드_1109.pdf 문구' },
});

export function buildPaste(cards, v3, overrides = {}) {
  const problems = [];
  const agendas = { 1: [], 2: [], 3: [] };
  const differsFromCards = [];
  const seen = new Set();
  for (const card of cards) {
    const no = String(card?.no ?? '');
    const m = /^([123])-(\d{1,2})$/.exec(no);
    if (!m) {
      problems.push(`cards 번호 「${no}」 — N-M 모양이 아님`);
      continue;
    }
    const agendaNo = Number(m[1]);
    if (card.division !== agendaNo) problems.push(`${no}: cards division ${card.division} 이 번호 앞자리와 다름`);
    seen.add(no);
    const lines = agendas[agendaNo];
    if (Number(m[2]) !== lines.length + 1) problems.push(`${no}: 순서가 어긋남(의제${agendaNo} ${lines.length + 1}번째 자리)`);
    const raw = v3[no];
    if (typeof raw !== 'string' || !raw.trim()) {
      problems.push(`${no}: 확정 제목 v3 에 없음`);
      lines.push(`${no}-안1 (없음)`);
      continue;
    }
    const title = (overrides[no]?.title ?? raw).trim();
    if (/[\r\n]/.test(title)) problems.push(`${no}: 제목에 줄바꿈이 있음(한 줄 = 한 건이 깨진다)`);
    const line = `${no}-안1 ${title}`;
    if (line.length > MAX_LINE) problems.push(`${no}: 줄이 ${line.length}자 — 폼 한계 ${MAX_LINE}자 초과`);
    if (title !== String(card.title ?? '').trim()) differsFromCards.push({ no, cards: String(card.title ?? '').trim(), v3: title });
    lines.push(line);
  }
  for (const no of Object.keys(v3)) if (!seen.has(no)) problems.push(`${no}: 확정 제목 v3 에만 있고 cards 에 없음`);
  for (const [n, want] of Object.entries(AGENDA_COUNTS)) {
    if (agendas[n].length !== want) problems.push(`의제${n}: ${agendas[n].length}건 — ${want}건이어야 함`);
  }
  if (problems.length) throw new Paste1114Error(problems);
  return { agendas, differsFromCards };
}

/** 한 묶음 = 줄마다 LF, 끝에 LF 하나, BOM 없음. */
export function pasteText(lines) {
  return `${lines.join('\n')}\n`;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** 원자료 두 개 → 쓸 파일 4개(agenda1~3.txt · sources.json). 시각을 넣지 않는다(다시 만들면 글자 그대로 같게). */
export function pasteFiles({ cardsBuf, hwpxBuf, cardsName, hwpxName }) {
  const cards = JSON.parse(cardsBuf.toString('utf8'));
  const v3 = hwpxTitles(readZipEntry(hwpxBuf, 'Contents/section0.xml').toString('utf8'));
  const { agendas, differsFromCards } = buildPaste(cards, v3, TITLE_OVERRIDES);
  const sources = {
    made_by: 'scripts/build-1114-paste.mjs',
    line_form: 'N-M-안1 제목 (한 줄 = 한 건)',
    title_source: `${hwpxName} — 11/9 확정 한글본(20_투표_최종안 U4 기본값 「한글본 기준」)`,
    cards: { file: cardsName, sha256: sha256(cardsBuf) },
    hwpx: { file: hwpxName, sha256: sha256(hwpxBuf) },
    counts: Object.fromEntries(Object.entries(agendas).map(([n, l]) => [n, l.length])),
    differs_from_cards: differsFromCards,
    overrides: Object.entries(TITLE_OVERRIDES).map(([no, o]) => ({ no, v3: v3[no]?.trim() ?? null, title: o.title, why: o.why })),
  };
  return {
    'agenda1.txt': pasteText(agendas[1]),
    'agenda2.txt': pasteText(agendas[2]),
    'agenda3.txt': pasteText(agendas[3]),
    'sources.json': `${JSON.stringify(sources, null, 2)}\n`,
  };
}
