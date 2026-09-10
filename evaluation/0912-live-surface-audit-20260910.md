# 9/12 실서비스 로그인 표면 감사

- 실행 시각: 2026-09-10 KST
- 대상: `https://climate-assembly.org/mod`, `https://climate-assembly.org/hq?ops=1`
- 배포 revision: `a25b2a3826a6ba343e187928193ff3a03fad123f`
- 방식: 실서비스 HTML·JavaScript를 Chromium으로 실행하되 Supabase HTTP·WebSocket은 합성 fixture로 가로채 운영 DB를 읽거나 쓰지 않았다.

## 결과

| 표면 | 결과 | 확인 내용 |
|---|---|---|
| HQ | PASS 8/8 | 개인 운영자 세션, v3 범위 읽기, CAS·멱등 재시도, 충돌 안내, 전체 비우기 보호, 서버 로그아웃 실패·성공 처리 |
| 조 화면 | 기능 PASS 10/10 | 코드 교환 후 토큰 재개, 다중 입력, 순차 꼭지 개방, 오프라인 초안, 재접속 복원, 자동 재전송, 마감 경고, ZIP 내보내기, 입력 불변식 |
| 외부 요청 불변식 | FAIL 1건 | Cloudflare가 실배포에 주입한 `https://static.cloudflareinsights.com` 요청 3건을 감지했다. Supabase 운영 요청이나 DB mutation은 아니지만, 엄격한 외부 요청 0건 계약에는 맞지 않는다. |

## 안전성 계수

- 운영 DB mutation: 0건
- legacy join-code RPC: 0건
- token 계약 위반: 0건
- 예상 밖 RPC: 0건
- 실제 WebSocket 연결: 0건
- capability 값의 초안 큐·증거 유출: 없음

## 판정

화면 기능과 데이터 보존 흐름은 현재 배포에서 정상이다. 다만 이 결과는 합성 응답을 사용했으므로 운영 계정·조 코드의 실제 positive login 증거가 아니며, 운영 DB의 membership·s22·156명 명부·HQ credential 보정·P2a가 승인·적용된 뒤 실제 브라우저로 다시 검증해야 한다.

Cloudflare Insights 요청은 기능 실패가 아니지만 외부 텔레메트리다. 행사 전 이를 유지할지 차단할지 별도 결정이 필요하며, 결론 전에는 외부 요청 0건으로 보고하지 않는다.

## 원증거

- `evaluation/0912-live-field-surface-20260910.json`
- `evaluation/0912-live-hq-surface-20260910.json`
