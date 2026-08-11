import { createContext, createElement, useContext, type ReactNode } from 'react';

export interface CanvasWriteResponse {
  error: unknown | null;
  retryable?: boolean;
  message?: string;
}

export type CanvasWriteOperation = () => PromiseLike<CanvasWriteResponse>;

export interface CanvasOperationResult {
  ok: boolean;
  kind: 'status' | 'alert';
  message: string;
  retry?: () => Promise<CanvasOperationResult>;
}

export type CanvasErrorReporter = (message: string, error: unknown) => void;
export type CanvasOperationRunner = (
  operation: () => Promise<CanvasOperationResult>,
) => Promise<CanvasOperationResult>;

export interface CanvasOperationOptions {
  retryable?: boolean;
  failureMessage?: string;
}

export interface CanvasAuditedEditAdapter {
  readCurrent: () => PromiseLike<{ data: { text: string } | null; error: unknown | null }>;
  updateIfUnchanged: () => PromiseLike<{ data: { id: string } | null; error: unknown | null }>;
  writeAudit: () => PromiseLike<CanvasWriteResponse>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function reconcileCommittedCanvasInsert<T>(
  response: CanvasWriteResponse,
  readExisting: () => PromiseLike<{ data: T | null; error: unknown | null }>,
  matchesExpected: (row: T) => boolean,
): Promise<CanvasWriteResponse> {
  if (!isRecord(response.error) || response.error.code !== '23505') return response;
  const existing = await readExisting();
  if (existing.error) return { error: existing.error };
  if (existing.data && matchesExpected(existing.data)) return { error: null };
  return {
    error: new Error('Canvas insert conflict did not match the expected row.'),
    retryable: false,
    message: '같은 식별자의 다른 데이터가 있어 작업을 중단했습니다. 최신 상태를 확인해 주세요.',
  };
}

function editConflict(): CanvasWriteResponse {
  return {
    error: new Error('Agenda text changed before the edit was completed.'),
    retryable: false,
    message: '다른 편집 내용이 먼저 반영되어 저장을 중단했습니다. 최신 내용을 확인해 주세요.',
  };
}

export function createCanvasAuditedEditOperation(
  before: string,
  after: string,
  adapter: CanvasAuditedEditAdapter,
): CanvasWriteOperation {
  let updateAttempted = false;
  let updateApplied = false;
  return async () => {
    if (!updateApplied) {
      if (updateAttempted) {
        const current = await adapter.readCurrent();
        if (current.error) return { error: current.error };
        if (current.data?.text === after) updateApplied = true;
        else if (current.data?.text !== before) return editConflict();
      }
      if (!updateApplied) {
        updateAttempted = true;
        const update = await adapter.updateIfUnchanged();
        if (update.error) return { error: update.error };
        if (!update.data) return editConflict();
        updateApplied = true;
      }
    }
    return adapter.writeAudit();
  };
}

const passthroughRunner: CanvasOperationRunner = async (operation) => operation();
const CanvasOperationContext = createContext<CanvasOperationRunner>(passthroughRunner);

export function CanvasOperationProvider({
  run,
  children,
}: {
  run: CanvasOperationRunner;
  children: ReactNode;
}) {
  return createElement(CanvasOperationContext.Provider, { value: run }, children);
}

export function useCanvasOperationRunner(): CanvasOperationRunner {
  return useContext(CanvasOperationContext);
}

const reportToConsole: CanvasErrorReporter = (message, error) => {
  console.error(message, error);
};

/** Executes one moderator write with consistent operator feedback and retry. */
export async function executeCanvasOperation(
  label: string,
  operation: CanvasWriteOperation | null,
  onError: CanvasErrorReporter = reportToConsole,
  options: CanvasOperationOptions = {},
): Promise<CanvasOperationResult> {
  if (!operation) {
    const error = new Error('Canvas data client is unavailable.');
    onError(`Canvas operation unavailable: ${label}`, error);
    return {
      ok: false,
      kind: 'alert',
      message: `작업 실행 환경을 사용할 수 없어 ${label}을 완료하지 못했습니다.`,
    };
  }

  try {
    const response = await operation();
    if (response.error) {
      onError(`Canvas operation failed: ${label}`, response.error);
      const retryable = response.retryable ?? options.retryable ?? true;
      return {
        ok: false,
        kind: 'alert',
        message: response.message ?? options.failureMessage ?? `${label}에 실패했습니다. 다시 시도해 주세요.`,
        retry: retryable ? () => executeCanvasOperation(label, operation, onError, options) : undefined,
      };
    }
    return { ok: true, kind: 'status', message: `${label} 완료` };
  } catch (error: unknown) {
    onError(`Canvas operation failed: ${label}`, error);
    return {
      ok: false,
      kind: 'alert',
      message: options.failureMessage ?? `${label}에 실패했습니다. 다시 시도해 주세요.`,
      retry: options.retryable === false
        ? undefined
        : () => executeCanvasOperation(label, operation, onError, options),
    };
  }
}
