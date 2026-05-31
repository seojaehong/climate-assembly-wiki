# Contributing — Climate Assembly Wiki

본 프로젝트는 한국 기후시민회의 모더레이터의 개인 아카이브이자, 시민·연구자 누구나 함께 다듬는 다국어 LLM 위키입니다. 모든 기여는 CC BY-SA 4.0 라이선스로 공개됩니다.

This project is a personal moderator archive and a community-maintained multilingual wiki. All contributions are released under CC BY-SA 4.0.

---

## 기여 방법 / How to Contribute

1. **이슈(Issues)** — 오탈자, 사실 오류, 제안 사항을 GitHub Issues에 등록.
2. **풀 리퀘스트(Pull Requests)** — 소스인 `content/ko/` 한국어 마크다운을 수정하거나, `translations/<lang>/`의 번역을 검수해 PR 제출.
3. **번역 검수(Translation review)** — 자동 생성된 번역에 라벨을 승급시키는 작업. 아래 3단계 라벨 시스템 참고.

원본은 항상 한국어(`content/ko/`)입니다. 번역만 수정하지 말고, 한국어 원문에서 의미가 모호하면 먼저 Issue로 제기해 주세요.

The Korean source under `content/ko/` is the single source of truth. If a translation is wrong because the Korean source is ambiguous, please open an Issue rather than only patching the translation.

---

## 번역 검수 라벨 3단계 / Translation Confidence Labels

각 번역 파일의 frontmatter에 `status` 필드로 표시합니다.

Each translation file declares a `status` field in its frontmatter.

| 라벨 / Label | 의미 / Meaning | 누가 / Who |
|---|---|---|
| `⚠️ machine` | Claude API 자동 번역, 미검수. 의미 오류 가능. | LLM only |
| `🔵 reviewed` | 1차 인간 검수 완료. 의미·용어·맥락 점검됨. | Bilingual reviewer |
| `🟢 native-verified` | 해당 언어의 원어민 검수 완료. 학술 인용 가능 수준. | Native speaker |

### 라벨 승급 절차 / Promotion Workflow

1. `machine` → `reviewed`
   - 해당 언어를 읽고 쓸 수 있는 기여자가 번역을 점검.
   - 용어집(`scripts/terms.yaml`)과 일관되는지 확인.
   - PR 본문에 “Reviewer: @handle, 검수 범위: 전체/부분” 명시.
2. `reviewed` → `native-verified`
   - 해당 언어의 원어민(또는 동등 수준)이 자연스러움·뉘앙스 점검.
   - 정치적·종교적·문화적 민감 표현 재확인.

원어민 검수자는 한 번에 한 의제 페이지만 맡아도 충분합니다. 작은 기여를 환영합니다.

Even one-page native review is welcome.

---

## 콘텐츠 거버넌스 / Content Governance

- **정치적 중립**: 특정 정당·정치인 비판/옹호 금지. 의제는 찬·반 양측을 균형 있게 서술.
- **사실 출처**: 정부 자료·학술 문헌·국제기구 보고서 등 1차 자료를 우선 인용.
- **개인정보**: 일반 시민참여단의 실명·연락처 게재 금지. 공인의 발언만 출처와 함께.
- **저작권**: 외부 자료 인용 시 출처와 라이선스 확인. 본 저장소 자체 콘텐츠는 CC BY-SA 4.0.

- **Political neutrality**: No partisan attacks or endorsements. Present pros and cons.
- **Sourcing**: Prefer primary sources (government, academic, IGOs).
- **Privacy**: Do not publish ordinary citizen participants' names or contacts.
- **Copyright**: Check licenses for external material. Our own content is CC BY-SA 4.0.

---

## 커밋 메시지 / Commit Messages

권장 형식 (Conventional Commits 단순화):

```
<type>: <subject>

예) docs: add agenda #14 climate dividend (ko)
    fix(en): correct NDC term in agenda-03
    chore: bump pagefind to 1.x
```

`type` 예시: `docs`, `fix`, `chore`, `feat`, `refactor`, `i18n`.

---

## 행동 강령 / Code of Conduct

상호 존중. 기여자의 국적·언어·전문성·정치 성향에 따른 차별 금지. 위반 시 메인테이너 판단에 따라 PR/이슈 제한.

Mutual respect. No discrimination by nationality, language, expertise, or political alignment.

문의 / Contact: GitHub Issues.
