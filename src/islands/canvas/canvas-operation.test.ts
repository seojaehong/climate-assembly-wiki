import { describe, expect, it, vi } from 'vitest';
import {
  createCanvasAuditedEditOperation,
  executeCanvasOperation,
  reconcileCommittedCanvasInsert,
} from './canvas-operation';

describe('executeCanvasOperation', () => {
  it('returns a visible completion notice after a successful write', async () => {
    const result = await executeCanvasOperation('의제 추가', async () => ({ error: null }));

    expect(result).toEqual({
      ok: true,
      kind: 'status',
      message: '의제 추가 완료',
    });
  });

  it('logs a failed write and exposes a retry that can recover', async () => {
    const onError = vi.fn();
    let attempts = 0;
    const operation = async () => {
      attempts += 1;
      return { error: attempts === 1 ? new Error('write failed') : null };
    };

    const failed = await executeCanvasOperation('의제 이동', operation, onError);

    expect(failed.ok).toBe(false);
    expect(failed.kind).toBe('alert');
    expect(failed.message).toBe('의제 이동에 실패했습니다. 다시 시도해 주세요.');
    expect(onError).toHaveBeenCalledWith('Canvas operation failed: 의제 이동', expect.any(Error));
    expect(failed.retry).toBeTypeOf('function');

    const recovered = await failed.retry?.();
    expect(recovered).toMatchObject({ ok: true, message: '의제 이동 완료' });
  });

  it('fails visibly when the data client is unavailable or the write throws', async () => {
    const onError = vi.fn();

    const unavailable = await executeCanvasOperation('의제 저장', null, onError);
    const thrown = await executeCanvasOperation(
      '의제 저장',
      async () => { throw new Error('network failed'); },
      onError,
    );

    expect(unavailable).toMatchObject({
      ok: false,
      message: '작업 실행 환경을 사용할 수 없어 의제 저장을 완료하지 못했습니다.',
    });
    expect(thrown).toMatchObject({
      ok: false,
      message: '의제 저장에 실패했습니다. 다시 시도해 주세요.',
    });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ambiguous non-idempotent insert failure', async () => {
    const result = await executeCanvasOperation(
      '의제 추가',
      async () => ({ error: new Error('response lost') }),
      vi.fn(),
      {
        retryable: false,
        failureMessage: '의제 추가 결과를 다시 확인해 주세요.',
      },
    );

    expect(result).toMatchObject({
      ok: false,
      message: '의제 추가 결과를 다시 확인해 주세요.',
    });
    expect(result.retry).toBeUndefined();
  });

  it('preserves an edit-specific recovery message and retries the same operation closure', async () => {
    const auditId = 'stable-audit-id';
    const attemptedIds: string[] = [];
    const result = await executeCanvasOperation('의제 내용 저장', async () => {
      attemptedIds.push(auditId);
      return { error: attemptedIds.length === 1 ? new Error('audit insert failed') : null };
    }, vi.fn(), {
      failureMessage: '의제 내용 또는 변경 이력 저장을 완료하지 못했습니다. 다시 시도하면 동일 작업을 안전하게 이어갑니다.',
    });

    expect(result).toMatchObject({
      ok: false,
      message: '의제 내용 또는 변경 이력 저장을 완료하지 못했습니다. 다시 시도하면 동일 작업을 안전하게 이어갑니다.',
    });
    expect(result.retry).toBeTypeOf('function');

    await result.retry?.();
    expect(attemptedIds).toEqual([auditId, auditId]);
  });
});

describe('reconcileCommittedCanvasInsert', () => {
  it('accepts a duplicate only when the stored row matches the expected insert', async () => {
    const response = { error: { code: '23505' } };
    const matching = await reconcileCommittedCanvasInsert(
      response,
      async () => ({ data: { id: 'stable-id', text: 'same' }, error: null }),
      (row) => row.id === 'stable-id' && row.text === 'same',
    );
    const mismatched = await reconcileCommittedCanvasInsert(
      response,
      async () => ({ data: { id: 'stable-id', text: 'different' }, error: null }),
      (row) => row.id === 'stable-id' && row.text === 'same',
    );

    expect(matching).toEqual({ error: null });
    expect(mismatched).toMatchObject({ error: expect.any(Error), retryable: false });
  });

  it('does not reinterpret other unique violations or unreadable conflicts', async () => {
    const readExisting = vi.fn(async () => ({ data: null, error: null }));
    const otherError = { error: { code: '42501' } };
    const untouched = await reconcileCommittedCanvasInsert(otherError, readExisting, () => true);
    const unreadable = await reconcileCommittedCanvasInsert(
      { error: { code: '23505' } },
      async () => ({ data: null, error: new Error('read failed') }),
      () => true,
    );

    expect(untouched).toBe(otherError);
    expect(readExisting).not.toHaveBeenCalled();
    expect(unreadable).toMatchObject({ error: expect.any(Error) });
  });
});

describe('createCanvasAuditedEditOperation', () => {
  it('retries only the stable audit event after the guarded update succeeds', async () => {
    const updateIfUnchanged = vi.fn(async () => ({ data: { id: 'agenda-1' }, error: null }));
    const writeAudit = vi.fn()
      .mockResolvedValueOnce({ error: new Error('audit failed') })
      .mockResolvedValueOnce({ error: null });
    const operation = createCanvasAuditedEditOperation('before', 'after', {
      readCurrent: vi.fn(async () => ({ data: { text: 'after' }, error: null })),
      updateIfUnchanged,
      writeAudit,
    });

    const failed = await executeCanvasOperation('edit', operation, vi.fn());
    const recovered = await failed.retry?.();

    expect(recovered?.ok).toBe(true);
    expect(updateIfUnchanged).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledTimes(2);
  });

  it('reconciles an unknown update response without overwriting a later edit', async () => {
    const updateIfUnchanged = vi.fn(async () => { throw new Error('response lost'); });
    const readCurrent = vi.fn(async () => ({ data: { text: 'different edit' }, error: null }));
    const writeAudit = vi.fn(async () => ({ error: null }));
    const operation = createCanvasAuditedEditOperation('before', 'after', {
      readCurrent,
      updateIfUnchanged,
      writeAudit,
    });

    const failed = await executeCanvasOperation('edit', operation, vi.fn());
    const conflict = await failed.retry?.();

    expect(conflict).toMatchObject({ ok: false, retry: undefined });
    expect(updateIfUnchanged).toHaveBeenCalledTimes(1);
    expect(readCurrent).toHaveBeenCalledTimes(1);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it('continues with the audit when a lost update response already applied the target text', async () => {
    const updateIfUnchanged = vi.fn(async () => { throw new Error('response lost'); });
    const readCurrent = vi.fn(async () => ({ data: { text: 'after' }, error: null }));
    const writeAudit = vi.fn(async () => ({ error: null }));
    const operation = createCanvasAuditedEditOperation('before', 'after', {
      readCurrent,
      updateIfUnchanged,
      writeAudit,
    });

    const failed = await executeCanvasOperation('edit', operation, vi.fn());
    const recovered = await failed.retry?.();

    expect(recovered?.ok).toBe(true);
    expect(updateIfUnchanged).toHaveBeenCalledTimes(1);
    expect(readCurrent).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it('retries the guarded update when a lost response left the original text unchanged', async () => {
    const updateIfUnchanged = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ data: { id: 'agenda-1' }, error: null });
    const readCurrent = vi.fn(async () => ({ data: { text: 'before' }, error: null }));
    const writeAudit = vi.fn(async () => ({ error: null }));
    const operation = createCanvasAuditedEditOperation('before', 'after', {
      readCurrent,
      updateIfUnchanged,
      writeAudit,
    });

    const failed = await executeCanvasOperation('edit', operation, vi.fn());
    const recovered = await failed.retry?.();

    expect(recovered?.ok).toBe(true);
    expect(updateIfUnchanged).toHaveBeenCalledTimes(2);
    expect(readCurrent).toHaveBeenCalledTimes(1);
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it('fails without retry when the original text no longer matches', async () => {
    const operation = createCanvasAuditedEditOperation('before', 'after', {
      readCurrent: vi.fn(async () => ({ data: { text: 'different edit' }, error: null })),
      updateIfUnchanged: vi.fn(async () => ({ data: null, error: null })),
      writeAudit: vi.fn(async () => ({ error: null })),
    });

    const result = await executeCanvasOperation('edit', operation, vi.fn());

    expect(result).toMatchObject({ ok: false, retry: undefined });
    expect(result.message).toContain('다른 편집 내용');
  });
});
