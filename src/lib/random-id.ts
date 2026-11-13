/**
 * 무작위 기기 번호. crypto.randomUUID 가 없는 옛 브라우저(iOS 15.4 미만 · Chrome 92 미만)에서는
 * 시각 + Math.random 으로 만든다(서버 client_id 조건 8~80자를 늘 채운다).
 */
export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
