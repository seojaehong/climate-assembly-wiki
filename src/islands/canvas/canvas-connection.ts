export type CanvasConnectionStatus = 'loading' | 'ready' | 'degraded' | 'error';

export interface CanvasConnectionState {
  status: CanvasConnectionStatus;
  message: string;
}

export type CanvasConnectionErrorReporter = (message: string, error: unknown) => void;

const reportToConsole: CanvasConnectionErrorReporter = (message, error) => {
  console.error(message, error);
};

export function canvasConnectionUnavailable(): CanvasConnectionState {
  return {
    status: 'degraded',
    message: '데이터 연결을 사용할 수 없어 읽기 전용 안내만 표시합니다.',
  };
}

export function canvasConnectionFailure(
  stage: string,
  error: unknown,
  onError: CanvasConnectionErrorReporter = reportToConsole,
): CanvasConnectionState {
  onError(`Canvas data load failed: ${stage}`, error);
  return {
    status: 'error',
    message: '캔버스 데이터를 불러오지 못했습니다. 다시 시도해 주세요.',
  };
}

export function canvasMalformedRealtimePayload(
  table: 'agenda' | 'agenda_link',
  onError: CanvasConnectionErrorReporter = reportToConsole,
): CanvasConnectionState {
  return canvasConnectionFailure(
    `realtime payload: ${table}`,
    new Error('Invalid realtime payload.'),
    onError,
  );
}

export function connectionFromRealtimeStatus(
  status: string,
  onError: CanvasConnectionErrorReporter = reportToConsole,
): CanvasConnectionState | null {
  if (status === 'SUBSCRIBED') {
    return { status: 'ready', message: '실시간 연결됨' };
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    const error = new Error(`Realtime channel status: ${status}`);
    onError(`Canvas realtime subscription failed: ${status}`, error);
    return {
      status: 'error',
      message: '실시간 연결이 끊겼습니다. 다시 연결해 주세요.',
    };
  }
  return null;
}
