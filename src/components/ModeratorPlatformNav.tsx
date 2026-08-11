import type { CSSProperties } from 'react';

type ModeratorPlatformSurface = 'live' | 'canvas' | 'graph' | 'guide';

interface ModeratorPlatformNavProps {
  current: ModeratorPlatformSurface;
}

const SURFACES: ReadonlyArray<{
  id: ModeratorPlatformSurface;
  href: string;
  label: string;
}> = [
  { id: 'live', href: '/ko/moderator/live/', label: '라이브 입력' },
  { id: 'canvas', href: '/ko/moderator/canvas/', label: '캔버스 작업대' },
  { id: 'graph', href: '/workshop-graph/', label: '온톨로지 그래프' },
  { id: 'guide', href: '/workshop-graph/guide/', label: '그래프 사용설명서' },
];

const navStyle: CSSProperties = {
  background: '#0B2E4F',
  borderBottom: '2px solid #2F8F83',
  color: '#FFFFFF',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 12,
  padding: '10px 16px',
  position: 'relative',
  zIndex: 100,
};

const descriptionStyle: CSSProperties = {
  color: '#D9EAF4',
  flex: '1 1 360px',
  fontSize: 13,
  lineHeight: 1.5,
  margin: 0,
};

const listStyle: CSSProperties = {
  display: 'flex',
  flex: '1 1 auto',
  flexWrap: 'wrap',
  gap: 8,
  justifyContent: 'flex-end',
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

function linkStyle(current: boolean): CSSProperties {
  return {
    alignItems: 'center',
    background: current ? '#FFFFFF' : '#123F68',
    border: `2px solid ${current ? '#FFFFFF' : '#79B9D4'}`,
    borderRadius: 8,
    color: current ? '#0B2E4F' : '#FFFFFF',
    display: 'inline-flex',
    fontSize: 13,
    fontWeight: 800,
    minHeight: 44,
    padding: '8px 12px',
    textDecoration: 'none',
  };
}

export default function ModeratorPlatformNav({ current }: ModeratorPlatformNavProps) {
  return (
    <nav aria-label="숙의 모더레이션 플랫폼" style={navStyle}>
      <p style={descriptionStyle}>
        <strong style={{ color: '#FFFFFF' }}>숙의 모더레이션 플랫폼</strong>
        {' · 시민 발언과 논증 관계를 보존해 숙의·모더레이션을 지원합니다. '}
        <strong style={{ color: '#FFFFFF' }}>회의의 결정을 대신하지 않습니다.</strong>
      </p>
      <ul style={listStyle}>
        {SURFACES.map((surface) => {
          const selected = current === surface.id;
          return (
            <li key={surface.id}>
              <a
                href={surface.href}
                aria-current={selected ? 'page' : undefined}
                style={linkStyle(selected)}
              >
                {surface.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
