function requireObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function requireText(value, message) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function optionalText(value, message) {
  if (value == null) return null;
  return requireText(value, message);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAMESPACED_ID_PATTERN = /^(?=.{2,128}$)(?=.*[._:-])[A-Za-z][A-Za-z0-9._:-]+$/;

function requireOpaqueId(value, message) {
  const identifier = requireText(value, message);
  if (UUID_PATTERN.test(identifier)) return identifier.toLowerCase();
  if (!NAMESPACED_ID_PATTERN.test(identifier)) throw new Error(message);
  return identifier;
}

function normalizeIdList(value, invalidMessage, duplicateMessage) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(invalidMessage);
  const seen = new Set();
  return value.map((identifier) => {
    const opaqueId = requireOpaqueId(identifier, invalidMessage);
    if (seen.has(opaqueId)) throw new Error(duplicateMessage);
    seen.add(opaqueId);
    return opaqueId;
  });
}

function normalizeProvenance(value, emptyMessage) {
  const provenance = {
    sourceUids: normalizeIdList(value.was_derived_from, 'Invalid source UID', 'Duplicate source UID'),
    transcriptChunkIds: normalizeIdList(value.transcript_chunk_ids, 'Invalid transcript chunk ID', 'Duplicate transcript chunk ID'),
    citedUids: normalizeIdList(value.cited_uids, 'Invalid cited source', 'Duplicate cited source'),
  };
  if (provenance.sourceUids.length + provenance.transcriptChunkIds.length + provenance.citedUids.length === 0) {
    throw new Error(emptyMessage);
  }
  return provenance;
}

function normalizeTimeSpan(value) {
  if (value == null) return null;
  const span = requireObject(value, 'Invalid recommendation time span');
  const normalizeBoundary = (boundary) => {
    if (boundary == null) return null;
    if (typeof boundary !== 'number' || !Number.isFinite(boundary)) {
      throw new Error('Invalid recommendation time span');
    }
    return boundary;
  };
  return { start: normalizeBoundary(span.start), end: normalizeBoundary(span.end) };
}

function normalizeMinorityConcern(value) {
  const concern = requireObject(value, 'Invalid minority concern');
  return {
    id: requireOpaqueId(concern.minority_id, 'Invalid minority concern id'),
    title: requireText(concern.title, 'Invalid minority concern title'),
    text: requireText(concern.text ?? concern.summary, 'Invalid minority concern text'),
    provenance: normalizeProvenance(concern, 'Minority concern requires cited sources'),
  };
}

function normalizeRecommendation(value) {
  const recommendation = requireObject(value, 'Invalid recommendation candidate');
  if (recommendation.kind !== 'recommendation_candidate'
    || recommendation.review_status !== 'draft') {
    throw new Error('Invalid recommendation candidate');
  }
  const minority = recommendation.minority ?? [];
  if (!Array.isArray(minority)) throw new Error('Invalid minority concerns');
  const minorityConcerns = minority.map(normalizeMinorityConcern);
  const minorityIds = new Set();
  for (const concern of minorityConcerns) {
    if (minorityIds.has(concern.id)) throw new Error('Duplicate minority concern id');
    minorityIds.add(concern.id);
  }
  return {
    id: requireOpaqueId(recommendation.rec_id, 'Invalid recommendation id'),
    title: requireText(recommendation.title, 'Invalid recommendation title'),
    summary: optionalText(recommendation.summary, 'Invalid recommendation summary'),
    timeSpan: normalizeTimeSpan(recommendation.time_span),
    provenance: normalizeProvenance(recommendation, 'Recommendation candidate requires cited sources'),
    minorityConcerns,
  };
}

function normalizeQuality(value) {
  if (value == null) return null;
  const quality = requireObject(value, 'Invalid quality signal');
  const label = quality.validity_label ?? quality.label;
  const allowedLabels = new Set(['official-5indicators', 'exploratory-text-metric', 'review-signal']);
  if (typeof label !== 'string' || !allowedLabels.has(label)) throw new Error('Invalid quality signal');
  if (quality.reliability != null && typeof quality.reliability !== 'boolean') {
    throw new Error('Invalid quality reliability flag');
  }
  return {
    label: requireText(label, 'Invalid quality signal'),
    sourceReliabilityFlag: quality.reliability === true,
    limitationsNotice: requireText(quality.limitations_notice, 'Invalid quality limitations notice'),
    provenance: normalizeProvenance(quality, 'Quality signal requires cited sources'),
  };
}

export function parseGraphAdvisoryAssets(meta) {
  const sourceMeta = requireObject(meta, 'Invalid graph metadata');
  const values = sourceMeta.recommendations ?? [];
  if (!Array.isArray(values)) throw new Error('Invalid recommendation candidates');
  const recommendations = values.map(normalizeRecommendation);
  const recommendationIds = new Set();
  for (const recommendation of recommendations) {
    if (recommendationIds.has(recommendation.id)) throw new Error('Duplicate recommendation id');
    recommendationIds.add(recommendation.id);
  }
  const quality = normalizeQuality(sourceMeta.quality);
  return {
    recommendations,
    quality,
    requiresHumanReview: recommendations.length > 0 || quality !== null,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatTime(seconds) {
  if (seconds == null) return '';
  const minute = Math.floor(seconds / 60);
  const second = Math.floor(seconds % 60);
  return `${minute}:${String(second).padStart(2, '0')}`;
}

function formatTimeSpan(span) {
  if (!span || (span.start == null && span.end == null)) return '시간 미상';
  return `${formatTime(span.start)}~${formatTime(span.end)}`;
}

function qualityLabel(value) {
  if (value === 'official-5indicators') return 'DQI 공식 5지표';
  if (value === 'exploratory-text-metric') return 'DQI 탐색적 지표';
  return value;
}

function renderIdGroup(label, identifiers) {
  if (identifiers.length === 0) return '';
  return `
    <details>
      <summary>${label} ${identifiers.length}건</summary>
      <ul>${identifiers.map((identifier) => `<li><code>${escapeHtml(identifier)}</code></li>`).join('')}</ul>
    </details>`;
}

function renderProvenance(provenance) {
  return [
    renderIdGroup('출처 UID', provenance.sourceUids),
    renderIdGroup('전사 chunk ID', provenance.transcriptChunkIds),
    renderIdGroup('인용 UID', provenance.citedUids),
  ].join('');
}

function renderMinorityConcern(concern) {
  return `
    <li>
      <b>${escapeHtml(concern.title)}</b>
      ${concern.text ? `<br>${escapeHtml(concern.text)}` : ''}
      ${renderProvenance(concern.provenance)}
    </li>`;
}

export function advisoryAssetSummary(assets) {
  const metaLabels = [];
  if (assets.recommendations.length > 0) metaLabels.push(`권고 후보 ${assets.recommendations.length}건`);
  if (assets.quality) metaLabels.push('품질 신호');
  const buttonLabel = assets.recommendations.length > 0 && assets.quality
    ? `권고 후보·품질 신호 ${assets.recommendations.length}`
    : assets.recommendations.length > 0
      ? `권고 후보 ${assets.recommendations.length}`
      : assets.quality ? '품질 신호' : '';
  return { metaLabels, buttonLabel };
}

export function renderGraphAdvisoryAssets(assets) {
  const quality = assets.quality ? `
    <section class="og-s-sec">
      <h4>품질 신호</h4>
      <div class="og-s-text">
        <b>${escapeHtml(qualityLabel(assets.quality.label))}</b><br>
        ${assets.quality.sourceReliabilityFlag ? '원천 신뢰성 플래그 있음<br>' : ''}
        ${escapeHtml(assets.quality.limitationsNotice)}
        ${renderProvenance(assets.quality.provenance)}
      </div>
    </section>` : '';
  const recommendations = assets.recommendations.length > 0 ? `
    <section class="og-s-sec">
      <h4>권고 후보</h4>
      <div class="og-s-rel">
        ${assets.recommendations.map((recommendation) => `
          <article class="og-r">
            <b>${escapeHtml(recommendation.title)}</b><br>
            ${recommendation.summary ? `${escapeHtml(recommendation.summary)}<br>` : ''}
            <span style="color:#9aa7b8">논의 시각 ${escapeHtml(formatTimeSpan(recommendation.timeSpan))}</span>
            ${renderProvenance(recommendation.provenance)}
            ${recommendation.minorityConcerns.length > 0 ? `
              <div style="color:#ffd43b">소수 우려 ${recommendation.minorityConcerns.length}건 별도 보존</div>
              <ul aria-label="보존된 소수 우려">${recommendation.minorityConcerns.map(renderMinorityConcern).join('')}</ul>` : ''}
          </article>`).join('')}
      </div>
    </section>` : '';
  return `
    <button class="og-s-close" data-side-close aria-label="자산 패널 닫기">✕</button>
    <div>
      <span class="og-s-badge" style="background:#7048e8;color:#fff">읽기전용 · 사람 검수 필요</span>
      <div class="og-s-label">분석 보조 자산</div>
      <p class="og-s-text">권고 후보는 결정이 아니며, 품질 신호는 진실 판정이 아닙니다.</p>
      ${quality}${recommendations}
    </div>`;
}
