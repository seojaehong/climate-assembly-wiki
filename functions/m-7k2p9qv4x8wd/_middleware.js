// 숙의 지도(공개판) 접속 잠금 — HTTP Basic. 2026-09-07.
// 경로 이름은 공개 저장소에 보이므로 비밀이 아니다. 잠금은 이 암호다.
// 암호 원문은 저장소에 없다. SHA-256 만 둔다. 바꾸려면 아래 상수를 갈거나
// Pages 환경변수 MAP_ACCESS_SHA256 으로 덮어쓴다(환경변수가 우선).
// 사용자 이름은 보지 않는다. 검색 차단은 _headers(X-Robots-Tag)·robots.txt·meta 가 함께 건다.
const DEFAULT_SHA256 = '5c20093701d2521bb9fd338c3490038f02ed252e10fa7f20177df39d7e67bf35';
const DENY_HEADERS = {
  'WWW-Authenticate': 'Basic realm="climate-assembly map", charset="UTF-8"',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Content-Type': 'text/plain; charset=utf-8',
};

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function passwordFrom(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const at = decoded.indexOf(':');
    return at >= 0 ? decoded.slice(at + 1) : decoded;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const expected = (context.env && context.env.MAP_ACCESS_SHA256) || DEFAULT_SHA256;
  const given = passwordFrom(context.request.headers.get('Authorization'));
  if (given !== null && (await sha256Hex(given)) === expected) {
    const upstream = await context.next();
    const response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return response;
  }
  return new Response('접속 암호가 필요합니다. 브라우저의 사용자 이름은 아무거나, 암호는 안내받은 것을 넣습니다.', { status: 401, headers: DENY_HEADERS });
}
