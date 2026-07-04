import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const readText = (path) => readFileSync(path, 'utf8');

describe('workshop graph final-decision readability', () => {
  test('final decision showcase uses a high-contrast projector profile', () => {
    const html = readText('public/workshop-graph/index.html');
    const sources = JSON.parse(readText('public/workshop-graph/sources.json'));

    const finalSources = sources.sources
      .filter((source) => source.id.startsWith('final-'))
      .map((source) => source.id);

    expect(finalSources).toContain('final-regulation-decisions-0704');
    expect(finalSources).toContain('final-agenda-decisions-0704');
    expect(html).toContain('function isFinalDecisionShowcase()');
    expect(html).toContain('body.og-final-decision-showcase');
    expect(html).toContain('pretendard.css');
    expect(html).toContain("html,body,#og-app,button,input,select,textarea{font-family:'Pretendard','Noto Sans KR','Malgun Gothic',sans-serif;font-weight:700}");
    expect(html).toContain('body.og-final-decision-showcase .og-surface-role{font-size:17px;font-weight:800');
    expect(html).toContain('body.og-final-decision-showcase .og-s-rel .og-r{font-size:15px;font-weight:800');
    expect(html).toContain('body.og-final-decision-showcase .og-hub-chip{max-width:320px;min-height:36px;font-size:15px;font-weight:900');
    expect(html).toContain('finalDecisionProjectorMode');
    expect(html).toContain("return curView === '2d' && String(curSource || '').startsWith('final-');");
    expect(html).toContain('function fitFinalDecisionViewport()');
    expect(html).toContain('if (isFinalDecisionShowcase()) fitFinalDecisionViewport();');
    expect(html).toContain('function shouldShowFinalNodeLabel(node)');
    expect(html).toContain("if (finalDecisionProjectorMode) return shouldShowFinalNodeLabel(n) ? n.data('label') || '' : '';");
    expect(html).toContain("'shape': n => finalDecisionProjectorMode && shouldShowFinalNodeLabel(n) ? 'round-rectangle' : 'ellipse'");
    expect(html).toContain("'color': finalDecisionProjectorMode ? '#0f172a'");
    expect(html).toContain("'text-outline-width': finalDecisionProjectorMode ? 3.5");
    expect(html).toContain("'border-color': n => finalDecisionProjectorMode");
    expect(html).toContain("'font-size': finalDecisionProjectorMode ? '24px'");
    expect(html).toContain("'font-size': finalDecisionProjectorMode ? '18px'");
    expect(html).toContain("'font-family': finalDecisionProjectorMode ? 'Pretendard");
    expect(html).toContain("'text-background-opacity': finalDecisionProjectorMode ? 0.96");
    expect(html).toContain('else if (isFinalDecisionShowcase()) fitFinalDecisionViewport();');
    expect(html).toContain('if (physicsOn || showcaseMode) applyPhysics();');
  });
});
