import { describe, expect, it, vi } from 'vitest';
import {
  canvasConnectionFailure,
  canvasMalformedRealtimePayload,
  canvasConnectionUnavailable,
  connectionFromRealtimeStatus,
} from './canvas-connection';

describe('canvas connection state', () => {
  it('uses an explicit degraded state when the data client is unavailable', () => {
    expect(canvasConnectionUnavailable()).toEqual({
      status: 'degraded',
      message: '데이터 연결을 사용할 수 없어 읽기 전용 안내만 표시합니다.',
    });
  });

  it('logs initial load failures without exposing source data', () => {
    const onError = vi.fn();
    const state = canvasConnectionFailure('agenda list', new Error('private row detail'), onError);

    expect(state).toEqual({
      status: 'error',
      message: '캔버스 데이터를 불러오지 못했습니다. 다시 시도해 주세요.',
    });
    expect(onError).toHaveBeenCalledWith('Canvas data load failed: agenda list', expect.any(Error));
  });

  it('maps realtime subscription states and logs connection failures', () => {
    const onError = vi.fn();

    expect(connectionFromRealtimeStatus('SUBSCRIBED', onError)).toEqual({
      status: 'ready',
      message: '실시간 연결됨',
    });
    expect(connectionFromRealtimeStatus('CHANNEL_ERROR', onError)).toEqual({
      status: 'error',
      message: '실시간 연결이 끊겼습니다. 다시 연결해 주세요.',
    });
    expect(onError).toHaveBeenCalledWith(
      'Canvas realtime subscription failed: CHANNEL_ERROR',
      expect.any(Error),
    );
  });

  it('fails closed when a realtime payload cannot be validated', () => {
    const onError = vi.fn();
    const state = canvasMalformedRealtimePayload('agenda', onError);

    expect(state).toEqual({
      status: 'error',
      message: '캔버스 데이터를 불러오지 못했습니다. 다시 시도해 주세요.',
    });
    expect(onError).toHaveBeenCalledWith(
      'Canvas data load failed: realtime payload: agenda',
      expect.any(Error),
    );
  });
});
