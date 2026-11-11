#!/usr/bin/env node
/**
 * 11/14 전체회의 의결 투표지 붙여넣기 묶음 만들기(손으로 쓰지 않는다).
 *
 *   node scripts/build-1114-paste.mjs --cards <cards_1114.json> --hwpx <20261109-권고안_확정_제목_v3.hwpx> [--out docs/1114-paste]
 *
 * 쓰는 파일: agenda1.txt(19줄) · agenda2.txt(28줄) · agenda3.txt(23줄) · all.txt(70줄, 11/11 한 장 투표지) · sources.json(원자료 이름 · sha256 · cards 와 다른 번호).
 * 막히면(번호 누락 · 건수 · 순서 · 300자 초과 · 줄바꿈) 사유를 전부 적고 rc 2, 파일을 하나도 쓰지 않는다.
 * 규칙 = scripts/lib/paste-1114.mjs · 절차 = docs/1114-ballot-setup.md §3.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { Paste1114Error, pasteFiles } from './lib/paste-1114.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const cardsPath = arg('--cards');
const hwpxPath = arg('--hwpx');
const outDir = resolve(arg('--out') ?? 'docs/1114-paste');
if (!cardsPath || !hwpxPath) {
  console.error('사용: node scripts/build-1114-paste.mjs --cards <cards_1114.json> --hwpx <확정 제목 v3.hwpx> [--out docs/1114-paste]');
  process.exit(1);
}

let files;
try {
  files = pasteFiles({
    cardsBuf: readFileSync(cardsPath),
    hwpxBuf: readFileSync(hwpxPath),
    cardsName: basename(cardsPath),
    hwpxName: basename(hwpxPath),
  });
} catch (e) {
  console.error(e instanceof Paste1114Error ? e.message : `원자료를 읽지 못함 — ${e?.message ?? e}`);
  process.exit(2);
}

mkdirSync(outDir, { recursive: true });
for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text, 'utf8');
const src = JSON.parse(files['sources.json']);
console.log(`${outDir} — 의제1 ${src.counts[1]} · 의제2 ${src.counts[2]} · 의제3 ${src.counts[3]}건`);
console.log(`제목 = ${src.hwpx.file}. cards 와 글자가 다른 번호 ${src.differs_from_cards.length}건: ${src.differs_from_cards.map((d) => d.no).join(', ') || '없음'}`);
