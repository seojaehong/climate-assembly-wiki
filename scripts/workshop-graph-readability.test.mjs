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
    expect(html).toContain('finalDecisionProjectorMode');
    expect(html).toContain("'color': finalDecisionProjectorMode ? '#0f172a'");
    expect(html).toContain("'text-outline-width': finalDecisionProjectorMode ? 3.5");
    expect(html).toContain("'border-color': n => finalDecisionProjectorMode");
    expect(html).toContain("'font-size': finalDecisionProjectorMode ? '20px'");
    expect(html).toContain("'text-background-opacity': finalDecisionProjectorMode ? 0.96");
    expect(html).toContain('else if ((physicsOn || showcaseMode) && !isFinalDecisionShowcase()) applyPhysics();');
  });
});
