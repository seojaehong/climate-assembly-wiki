import { fitRecViews, type RecView } from './division-rec-edits';

/**
 * 카드 하나(또는 안 하나)의 세부권고 처리 목록 — 큰 화면 QR·결과, 운영 화면 안 카드.
 * 이름은 다루지 않는다(세부권고 글과 번호만). 글자 크기·줄 수는 fitRecViews 가 정한다.
 */
export default function DivisionRecList({ views, room, tone }: { views: readonly RecView[]; room: 'qr' | 'result' | 'operator'; tone: 'light' | 'dark' }) {
  if (!views.length) return null;
  const fit = room === 'operator' ? { items: [...views], more: 0, fontPx: 16 } : fitRecViews(views, room);
  const c =
    tone === 'dark'
      ? { text: '#E6F2F7', no: '#7FC8DE', struck: 'rgba(230,242,247,0.5)', tag: { 수정: '#FBBF24', 삭제: '#F87171', move: '#BFE3F0', 추가: '#34D399' }, border: 'rgba(255,255,255,0.2)' }
      : { text: '#1F2933', no: '#1F4E79', struck: '#8A97A0', tag: { 수정: '#9A5B00', 삭제: '#B91C1C', move: '#135C73', 추가: '#2F6F25' }, border: '#C4D8E4' };
  const tagColor = (v: RecView) =>
    v.mark === 'edited' ? c.tag.수정 : v.mark === 'deleted' ? c.tag.삭제 : v.mark === 'added' ? c.tag.추가 : c.tag.move;
  const clamp = room === 'operator' ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' };
  return (
    <ul
      data-testid={`rec-list-${room}`}
      data-count={views.length}
      className="mt-3 space-y-1.5 border-t-2 pt-3"
      style={{ borderColor: c.border, fontSize: `${fit.fontPx}px`, lineHeight: 1.3, color: c.text }}
    >
      {fit.items.map((v) => (
        <li key={v.key} data-mark={v.mark} className="flex gap-2" style={{ wordBreak: 'keep-all' }}>
          {v.tag ? (
            <span className="shrink-0 rounded px-1.5 font-extrabold tr-num" style={{ color: tagColor(v), border: `2px solid ${tagColor(v)}`, fontSize: '0.8em', alignSelf: 'flex-start' }}>
              {v.tag}
            </span>
          ) : null}
          <span style={{ ...clamp, textDecoration: v.struck ? 'line-through' : undefined, color: v.struck ? c.struck : undefined }}>
            {v.no ? <b className="mr-1.5 tr-num" style={{ color: v.struck ? c.struck : c.no }}>{v.no}</b> : null}
            {v.text}
          </span>
        </li>
      ))}
      {fit.more ? (
        <li data-testid="rec-list-more" className="font-extrabold" style={{ color: c.no }}>
          외 {fit.more}개
        </li>
      ) : null}
    </ul>
  );
}
