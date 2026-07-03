const MIN_SCORE = 1;
const MAX_SCORE = 4.9;
const SAMPLE_STEP = 0.5;

export function normalizeVoteCounts(counts) {
  const safeCounts = counts.map((count) => Math.max(0, Number(count) || 0));
  const maxCount = Math.max(...safeCounts, 0);
  if (maxCount <= 0) {
    return safeCounts.map((_, index) => Math.max(MIN_SCORE, Number((MAX_SCORE - SAMPLE_STEP * index).toFixed(2))));
  }
  return safeCounts.map((count) => {
    const score = MIN_SCORE + ((MAX_SCORE - MIN_SCORE) * count / maxCount);
    const stepped = Math.round(score * 2) / 2;
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Number(stepped.toFixed(2))));
  });
}

export function buildScoreRows(options, countsByName) {
  const counts = options.map((option) => countsByName[option.name] ?? 0);
  const scores = normalizeVoteCounts(counts);
  return [
    ['slot', 'name', 'short', 'color', 'c1', 'c2', 'c3', 'c4'],
    ...options.map((option, index) => {
      const score = scores[index];
      return [option.slot, option.name, option.short, option.color, score, score, score, score];
    }),
  ];
}

export function scoreToPosition(score) {
  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, Number(score) || MIN_SCORE));
  const normalized = (clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE);
  return {
    x: Number((0.08 + normalized * 0.84).toFixed(4)),
    y: Number((0.1 + normalized * 0.82).toFixed(4)),
  };
}
