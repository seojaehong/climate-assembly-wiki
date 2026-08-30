/**
 * 세션 slug 가 기본 인자로 다시 숨지 않게 지킨다.
 *
 * 2026-08-30 점검에서 나온 결함: `hq-submissions.ts` 의 여섯 함수가 세션 slug 를
 * **기본 인자**(`= DEFAULT_SESSION_SLUG`)로 갖고 있었고, 호출부는 한 곳도
 * 세션을 넘기지 않았다. 그래서 9.12 에 새 세션을 열어도 본부 화면 전체가
 * 8.29 를 가리켰을 것이다. 「전체 비우기」를 누르면 8.29 의 641줄이 지워진다.
 *
 * 이건 타입으로는 안 잡힌다 — 기본값이 있으면 인자를 빼도 정상 컴파일이다.
 * 그래서 **원문을 읽어** 기본값이 없는지, 호출부가 세션을 명시하는지 잰다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('세션 slug — 기본 인자 금지', () => {
  it('hq-submissions.ts 에 slug 기본 인자가 하나도 없다', () => {
    const src = read('lib/hq-submissions.ts');
    const defaults = src.match(/sessionSlug\s*:\s*string\s*=/g) ?? [];
    expect(defaults, `기본 인자 ${defaults.length}개 — 빠뜨리면 조용히 8.29 로 간다`).toHaveLength(0);
  });

  it('세션 상수는 한 곳에만 있다', () => {
    const src = read('lib/hq-submissions.ts');
    expect(src).toContain("export const CURRENT_SESSION_SLUG = ");
    // 문자열 리터럴로 박힌 slug 가 상수 정의 말고 또 있으면 안 된다.
    const literals = src.match(/'[0-9]{4}-[a-z-]+'/g) ?? [];
    expect(literals.length, `slug 리터럴 ${literals.length}개 — 정의 1곳만 허용`).toBeLessThanOrEqual(1);
  });

  it('본부 화면·전체비우기가 세션을 명시해 부른다', () => {
    for (const f of ['islands/mod/HqSubmissionBoard.tsx', 'islands/mod/ClearAllPanel.tsx']) {
      const src = read(f);
      // ★ `\([^)]*\)` 로 자르면 `phrase.trim()` 의 닫는 괄호에서 끊긴다(실제로 겪었다).
      //   호출 시작점부터 넉넉히 떠서 본다 — 인자 목록이 줄바꿈돼 있어도 잡힌다.
      const names =
        /(fetchHqSubmissions|fetchSubmissionKinds|fetchHqSubmissionHistory|fetchHqSubmissionCategories|clearAllSubmissions)\(/g;
      for (const m of src.matchAll(names)) {
        const window = src.slice(m.index, m.index + 160);
        const head = window.slice(0, 60);
        expect(window, `${f} — 세션을 안 넘긴다: ${head}`).toContain(
          'CURRENT_SESSION_SLUG'
        );
      }
    }
  });
});
