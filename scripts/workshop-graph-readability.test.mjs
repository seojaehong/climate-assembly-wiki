import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (path) => readFileSync(path, 'utf8');

describe('workshop graph final-decision readability', () => {
  test('final decision sources use the origin physics graph with readable colored node text', () => {
    const html = readText('public/workshop-graph/index.html');
    const sources = JSON.parse(readText('public/workshop-graph/sources.json'));

    const hiddenProcessSource = sources.sources.find((source) => source.id === 'final-process-to-conclusion-0704');
    const finalSources = sources.sources
      .filter((source) => !source.hidden)
      .filter((source) => source.id.startsWith('final-'))
      .map((source) => source.id);
    const menuSuppressedSources = sources.sources
      .filter((source) => !source.hidden && source.menu === false)
      .map((source) => source.id);

    expect(sources.default).toBe('final-regulation-decisions-0704');
    expect(hiddenProcessSource?.hidden).toBe(true);
    expect(finalSources).toContain('final-regulation-decisions-0704');
    expect(finalSources).toContain('final-agenda-decisions-0704');
    expect(finalSources).not.toContain('final-process-to-conclusion-0704');
    expect(menuSuppressedSources).toContain('workshop-2026-06-13');
    expect(menuSuppressedSources).toContain('source-coverage-2026-06-13');
    expect(menuSuppressedSources).toContain('regulation-2026-06-13');
    expect(html).toContain('function isFinalSourceId(sourceId)');
    expect(html).toContain('function isFinalSourceGraph()');
    expect(html).toContain('function isFinalDecisionShowcase()');
    expect(html).toContain('pretendard.css');
    expect(html).toContain('function getPublicSources()');
    expect(html).toContain('function getMenuSources()');
    expect(html).toContain('function isPublicSourceId(sourceId)');
    expect(html).toContain("const finalSourceDefault = isFinalSourceId(curSource) && !params.has('mode');");
    expect(html).toContain('if (!isPublicSourceId(curSource)) curSource = sources.default;');
    expect(html).toContain('for (const s of getMenuSources())');
    expect(html).toContain('return current && current.menu === false');
    expect(html).toContain('const meta = getPublicSources().find(s => s.id === srcId);');
    expect(html).toContain("showcaseMode = params.get('mode') === 'showcase' || finalSourceDefault;");
    expect(html).toContain("showcaseCount = [50,75,100].includes(Number(params.get('count'))) ? Number(params.get('count')) : (finalSourceDefault ? 100 : 50);");
    expect(html).toContain('if (isFinalSourceId(curSource)) return 34;');
    expect(html).toContain('applyFinalSourceShowcaseDefaults();');
    expect(html).toContain('body.og-final-decision-showcase .og-canvas{background:#ffffff}');
    expect(html).toContain('body.og-final-decision-showcase .og-controls > :not(#og-showcase-count-tog){display:none !important}');
    expect(html).toContain("return sourceId === 'final-regulation-decisions-0704' || sourceId === 'final-agenda-decisions-0704';");
    expect(html).toContain("return curView === '2d' && isFinalSourceId(curSource);");
    expect(html).toContain("return showcaseMode && isFinalSourceGraph();");
    expect(html).toContain('const finalSourceGraphMode = isFinalSourceGraph();');
    expect(html).toContain('const finalPhysicsGraphMode = isFinalSourceGraph();');
    expect(html).toContain("if (finalSourceGraphMode) return n.data('shortLabel') || n.data('label') || '';");
    expect(html).toContain("'background-color': n => palette[n.data('kind')] || '#888'");
    expect(html).toContain("'font-family': finalSourceGraphMode ? 'Pretendard, Noto Sans KR, Malgun Gothic, sans-serif'");
    expect(html).toContain("'font-weight': finalSourceGraphMode ? 800");
    expect(html).toContain("'font-size': finalSourceGraphMode ? '30px'");
    expect(html).toContain("'font-size': finalSourceGraphMode ? '30px' : (presentMode ? '18px' : '13px')");
    expect(html).toContain("'text-background-opacity': finalSourceGraphMode ? 0");
    expect(html).toContain("'text-valign': finalSourceGraphMode ? 'center'");
    expect(html).toContain("'shape': n => finalSourceGraphMode ? 'round-rectangle'");
    expect(html).toContain("'label': demo ? (showcaseEdgeLabels ? 'data(relKo)' : '') : (paper ? '' : 'data(relKo)')");
    expect(html).toContain('if (physicsOn || showcaseMode) applyPhysics();');
    expect(html).toContain('setTimeout(() => fitFinalDecisionViewport(), 1200);');
    expect(html).toContain('idealEdgeLength: finalPhysicsGraphMode ? 150 : 245');
    expect(html).toContain('edgeLength: finalPhysicsGraphMode ? 150 : (showcaseMode ? 245 : 110)');
    expect(html).toContain("${escapeHtml(ctx.node.text || '원문 전사 없음')}");
    expect(html).not.toContain("<p>${escapeHtml(shortText(ctx.node.text || '', 120))}</p>");
    expect(html).not.toContain("'background-color': n => finalSourceGraphMode ? '#ffffff'");
    expect(html).not.toContain('body{font-size:17px}');
    expect(html).not.toContain("html,body,#og-app,button,input,select,textarea{font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;font-weight:700}");
    expect(html).toContain('function fitFinalDecisionViewport()');
    expect(html).not.toContain('else if (isFinalDecisionShowcase()) fitFinalDecisionViewport();');
  });
});
