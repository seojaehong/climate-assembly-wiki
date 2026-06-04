/**
 * AgendaNetworkExcalidraw.tsx
 *
 * React island for the agenda network Excalidraw canvas.
 * Loaded via client:only="react" — no SSR.
 *
 * Props:
 *   initialData — scene skeleton JSON (elements array + appState)
 *   mode        — "view" (default) | "edit"
 *
 * On mount: dynamically imports Excalidraw (large bundle, deferred).
 * Converts skeleton elements via convertToExcalidrawElements() to
 * produce valid Excalidraw elements with required runtime fields.
 *
 * Korean labels render with system font fallback — Virgil/Cascadia
 * lack Korean glyphs. Acceptable for workshop use.
 */

import { useState, useEffect } from 'react';

interface SceneData {
  elements: object[];
  appState?: {
    viewBackgroundColor?: string;
    theme?: string;
    zoom?: { value: number };
  };
  files?: Record<string, unknown>;
}

interface AgendaNetworkExcalidrawProps {
  initialData: SceneData;
  mode?: 'view' | 'edit';
}

// Loaded module cached outside component to avoid re-importing on re-render
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedModule: any = null;

export default function AgendaNetworkExcalidraw({
  initialData,
  mode = 'view',
}: AgendaNetworkExcalidrawProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [mod, setMod] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cachedModule) {
      setMod(cachedModule);
      return;
    }
    import('@excalidraw/excalidraw')
      .then((m) => {
        if (cancelled) return;
        cachedModule = m;
        setMod(m);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.error('[AgendaNetworkExcalidraw] load error:', err);
        setError('Excalidraw 로드 실패: ' + err.message);
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '85vh', background: '#0d1117', color: '#f85149',
        fontFamily: 'system-ui', fontSize: 14,
      }}>
        {error}
      </div>
    );
  }

  if (!mod) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '85vh', background: '#0d1117',
        color: '#8b949e', fontFamily: 'system-ui', fontSize: 13, gap: 12,
      }}>
        <div style={{ fontSize: 20, letterSpacing: 4, color: '#30363d' }}>
          ◌ ◌ ◌
        </div>
        <div>의제 네트워크 캔버스 로딩 중</div>
        <div style={{ fontSize: 11, color: '#30363d' }}>
          (~3–5초, 첫 로드 시 번들 다운로드)
        </div>
      </div>
    );
  }

  const { Excalidraw, convertToExcalidrawElements } = mod;

  // Convert skeleton elements to valid Excalidraw elements
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hydratedElements = convertToExcalidrawElements(initialData.elements as any[]);

  const isViewMode = mode === 'view';

  return (
    <div style={{ height: '85vh', width: '100%', background: '#0d1117' }}>
      <Excalidraw
        initialData={{
          elements: hydratedElements,
          appState: {
            viewBackgroundColor: initialData.appState?.viewBackgroundColor ?? '#0d1117',
            theme: 'dark',
            zoom: initialData.appState?.zoom ?? { value: 0.5 },
          },
          files: initialData.files ?? {},
        }}
        theme="dark"
        viewModeEnabled={isViewMode}
        UIOptions={{
          canvasActions: {
            saveAsImage: true,
            export: false,
            clearCanvas: false,
            loadScene: false,
            theme: false,
          },
        }}
        langCode="ko-KR"
      />
    </div>
  );
}
