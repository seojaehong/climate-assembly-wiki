# Cloudflare Pages 배포 가이드

본 문서는 **2026 기후시민회의 위키**를 Cloudflare Pages에 배포하는 절차입니다.
M3(2026.8) 시점까지는 **비공개 프리뷰** 상태를 유지합니다 (robots.txt의 `Disallow: /` 유지).

## 권장 방식 — Cloudflare 대시보드 GitHub 통합 (5분)

가장 단순하고 자동 배포까지 한 번에 설정됩니다.

### 1. Cloudflare 계정 준비
1. https://dash.cloudflare.com/sign-up 에서 무료 계정 생성
2. 이메일 인증 완료

### 2. Pages 프로젝트 생성
1. 대시보드 좌측 메뉴 → **Workers & Pages** → **Create** → **Pages** 탭 → **Connect to Git**
2. **GitHub** 선택 → Cloudflare 권한 부여
3. 리포지토리 선택: `seojaehong/climate-assembly-wiki`
4. **Begin setup** 클릭

### 3. 빌드 설정

| 항목 | 값 |
|------|---|
| **Project name** | `climate-assembly-wiki` |
| **Production branch** | `main` |
| **Framework preset** | `Astro` (자동 감지됨) |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | (비워둠 — 리포 루트가 곧 wiki 프로젝트) |
| **Environment variables** | 없음 (MT 파이프라인 폐기로 API 키 불필요) |

> **주의**: 리포 루트에 `package.json`이 있는지 확인. 만약 PM이 `wiki/` 하위 폴더로 푸시했다면 **Root directory**에 `wiki`를 입력해야 합니다.

### 4. **Save and Deploy** 클릭

첫 빌드가 시작됩니다 (예상 2~3분). 완료되면 임시 도메인이 발급됩니다:

```
https://climate-assembly-wiki.pages.dev
```

### 5. 인덱싱 차단 확인 (★ 매우 중요 ★)

M3 이전까지 검색엔진 노출을 막아야 합니다.

1. 배포 완료 후 https://climate-assembly-wiki.pages.dev/robots.txt 접속
2. 다음이 보여야 함:
   ```
   User-agent: *
   Disallow: /
   ```
3. **Pages 프로젝트 → Settings → Builds & deployments**:
   - **Production branch**: `main` 만 활성화
   - **Preview deployments**: 자동 빌드는 켜두되, 외부 공유는 금지 (PM 승인 전 URL 공유 금지)

### 6. 도메인 옵션 (M3 결정)

| 옵션 | 비용 | 비고 |
|------|------|------|
| `climate-assembly-wiki.pages.dev` | 무료 | M3 출시까지 기본값 |
| 사용자 보유 도메인 (예: `*.조직도메인.kr`) | 0원 | DNS CNAME 추가만 |
| 신규 구입 (`climate-assembly.kr` 등) | 약 1.5만원/년 | 가비아·Cloudflare Registrar |

도메인 결정 후 **Pages 프로젝트 → Custom domains → Set up a custom domain** 에서 등록.

---

## 백업 방식 — GitHub Actions (수동 트리거 전용)

대시보드 방식이 막혔을 때 쓰는 비상 경로입니다.

### 사전 준비
1. Cloudflare 대시보드 → **My Profile** → **API Tokens** → **Create Token**
   - Template: **Edit Cloudflare Workers** 사용 또는 커스텀:
     - Permissions: `Account` → `Cloudflare Pages` → `Edit`
2. **Account ID** 복사: 대시보드 우측 사이드바
3. GitHub 리포 → **Settings → Secrets and variables → Actions** → **New secret**:
   - `CLOUDFLARE_API_TOKEN` = (1번 토큰)
   - `CLOUDFLARE_ACCOUNT_ID` = (2번 ID)

### 실행
GitHub 리포 → **Actions** 탭 → **Deploy to Cloudflare Pages (Backup / Manual)** → **Run workflow** → `main` 선택 → **Run workflow**.

자동 트리거(push)는 **의도적으로 비활성화**되어 있습니다. 시크릿 미등록 시에도 안전합니다 (워크플로우가 실패할 뿐 다른 영향 없음).

---

## 트러블슈팅

| 증상 | 원인 / 조치 |
|------|------------|
| 빌드 실패 `Cannot find module` | `npm ci` 가 아닌 `npm install` 사용 중일 수 있음 → 대시보드 Build command 확인 |
| `dist` 디렉토리 비어있음 | Build output을 `dist`로 (Astro 기본) |
| robots.txt가 404 | `public/robots.txt` 가 누락 → 본 리포에는 이미 존재 |
| 한글 페이지 깨짐 | 빌드 환경 locale 문제 — Cloudflare는 UTF-8 기본이라 발생 안 함 |
| 검색엔진에 노출됨 | robots.txt `Disallow: /` 유지되어 있는지 즉시 확인 |

---

## 검증 체크리스트 (배포 후)

- [ ] https://climate-assembly-wiki.pages.dev/ko 가 200 OK
- [ ] https://climate-assembly-wiki.pages.dev/en 가 200 OK
- [ ] https://climate-assembly-wiki.pages.dev/robots.txt 가 `Disallow: /` 포함
- [ ] 응답 헤더에 `X-Frame-Options: DENY` 포함 (DevTools → Network)
- [ ] `/assets/*` 응답에 `Cache-Control: max-age=31536000` 포함
- [ ] Pagefind 검색이 동작 (사이트 내 검색창)

---

## ✅ 인프라 보유 상황 (2026-05-31 기준)

- **GitHub 레포**: https://github.com/seojaehong/climate-assembly-wiki
- **Cloudflare Pages**: https://climate-assembly-wiki.pages.dev (활성·robots Disallow)
- **본도메인**: ★ **`climate-assembly.org`** — Cloudflare Registrar 등록 완료 (2026-05-31)

## 🎯 M3(2026.8) 출시 시점 도메인 연결 절차

도메인은 등록되어 있지만 ★ DNS는 아직 사이트에 연결되지 않음. M3 출시 시점에 다음 작업을 수행:

```
1. Cloudflare 대시보드 → Workers & Pages → climate-assembly-wiki
2. "Custom domains" 탭 → "Set up a custom domain"
3. climate-assembly.org 입력 → "Continue"
4. DNS는 Cloudflare에 이미 있으므로 자동 연결 (CNAME 생성)
5. Activate domain 클릭 → 약 1~5분 후 활성
6. 본 사이트는 https://climate-assembly.org 로 접근 가능
```

### 함께 진행할 작업
- `wiki/astro.config.mjs`의 `site`를 `https://climate-assembly.org`로 변경
- `wiki/public/robots.txt`에서 `Disallow: /` 제거 → 정상 인덱싱 허용
- (선택) `www.climate-assembly.org` 추가 → 루트로 301 리다이렉트
