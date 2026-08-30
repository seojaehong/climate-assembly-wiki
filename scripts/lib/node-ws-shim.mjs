/**
 * Node 20 에서 supabase-js 를 살리는 최소 스텁.
 *
 * 무엇이 문제인가
 *   `@supabase/realtime-js` 는 클라이언트를 만드는 순간 WebSocket 구현을 찾는다.
 *   못 찾으면 `Node.js 20 detected without native WebSocket support` 로 **죽는다**.
 *   Node 22 부터는 전역 WebSocket 이 있어서 안 죽는다.
 *   실측(2026-08-30): 이 저장소 스크립트 6본이 Node 20 에서 전부 이 지점에서
 *   죽었고, 그중 `build-kb-agenda-source.mjs` 때문에 `npm run build`(prebuild)가
 *   로컬에서 통째로 실패했다. CI 는 자격증명이 없어 blocker 로 빠져 지나간다.
 *
 * 왜 스텁으로 충분한가
 *   이 스크립트들은 `.rpc()`·`.from()` 만 쓴다 — 전부 HTTP(PostgREST)다.
 *   realtime 채널을 구독하지 않으므로 **생성자가 호출될 일이 없다.**
 *   탐지기는 `globalThis.WebSocket` 이 있는지만 본다.
 *
 * 왜 `ws` 패키지를 넣지 않았나
 *   쓰지도 않을 실시간 기능 때문에 의존성을 늘리지 않는다. 그리고 언젠가 누가
 *   실제로 채널을 구독하면 **조용히 동작하는 대신 아래 메시지로 즉시 터지는 편이
 *   낫다** — 무엇을 해야 하는지 그 자리에서 알려 준다.
 *
 * 쓰는 법 — createClient 를 부르기 **전에** import 한다.
 *   import './lib/node-ws-shim.mjs';
 */
if (typeof globalThis.WebSocket === 'undefined') {
  class UnsupportedWebSocket {
    constructor() {
      throw new Error(
        'realtime 연결을 시도했다 — 이 스크립트는 HTTP(RPC)만 쓰도록 되어 있다.\n' +
          '정말 실시간 구독이 필요하면 Node 22 이상에서 돌리거나 `ws` 를 설치해 ' +
          'globalThis.WebSocket 에 붙여라. (scripts/lib/node-ws-shim.mjs)'
      );
    }
  }
  globalThis.WebSocket = UnsupportedWebSocket;
}
