import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 1200 } });
await p.goto('http://localhost:4477/ko/moderator/insights/submission-lab/', { waitUntil: 'networkidle' });
await p.click('[data-testid="ontology-view-toggle"]');
await p.click('button[aria-pressed="false"]:has-text("모아보기")');
await p.waitForSelector('[data-testid="note-grid"]');
const card = '[data-testid="note-grid"] article:first-child';
await p.click(`${card} [data-testid="ontology-kind-buttons"] button[data-kind="Claim"]`);
await p.click(`${card} [data-testid="category-buttons"] button[data-category="common"]`);
await p.waitForTimeout(1500);
const probe = async (sel) => p.$eval(sel, (el) => {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, opacity: cs.opacity, inline: el.getAttribute('style') };
});
console.log('KIND  active :', JSON.stringify(await probe(`${card} [data-testid="ontology-kind-buttons"] button[data-kind="Claim"]`)));
console.log('KIND  idle   :', JSON.stringify(await probe(`${card} [data-testid="ontology-kind-buttons"] button[data-kind="Issue"]`)));
console.log('CAT   active :', JSON.stringify(await probe(`${card} [data-testid="category-buttons"] button[data-category="common"]`)));
const dur = await p.$eval(`${card} [data-testid="ontology-kind-buttons"] button[data-kind="Claim"]`, el => {
  const cs = getComputedStyle(el);
  return { duration: cs.transitionDuration, prop: cs.transitionProperty, delay: cs.transitionDelay };
});
console.log('transition   :', JSON.stringify(dur));
await b.close();
