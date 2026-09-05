import { describe, expect, it, vi } from 'vitest';
import { createSafeBrowserStorage } from './safe-browser-storage';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('createSafeBrowserStorage', () => {
  it('mirrors native values and reports reload-safe persistence', () => {
    const native = new MemoryStorage();
    const storage = createSafeBrowserStorage('localStorage', {
      getStorage: () => native,
      memory: new Map<string, string>(),
    });

    storage.setItem('token', 'one');
    expect(storage.getItem('token')).toBe('one');
    expect(native.getItem('token')).toBe('one');
    expect(storage.isPersistent()).toBe(true);
  });

  it('falls back to stable page memory when the global accessor throws', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fallback = vi.fn();
    const storage = createSafeBrowserStorage('sessionStorage', {
      getStorage: () => { throw new Error('blocked'); },
      memory: new Map<string, string>(),
      onFallback: fallback,
    });

    storage.setItem('token', 'memory-token');
    expect(storage.getItem('token')).toBe('memory-token');
    expect(storage.isPersistent()).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it('keeps the requested write in memory when native setItem starts failing', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const native = new MemoryStorage();
    native.setItem('existing', 'mirrored');
    const storage = createSafeBrowserStorage('localStorage', {
      getStorage: () => native,
      memory: new Map<string, string>(),
    });
    expect(storage.getItem('existing')).toBe('mirrored');
    native.setItem = () => { throw new Error('quota'); };

    storage.setItem('session', 'kept');

    expect(storage.getItem('existing')).toBe('mirrored');
    expect(storage.getItem('session')).toBe('kept');
    expect(storage.isPersistent()).toBe(false);
    warning.mockRestore();
  });
});
