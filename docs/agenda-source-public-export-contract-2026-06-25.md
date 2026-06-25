# 보호 KB 의제 공개 export 계약

작성일: 2026-06-25

## 목적

`public.kb_chunks`에는 해외 기후의회 권고와 국내/경기 의제 코퍼스가 들어 있지만, 이 테이블은 RLS로 anon 직접 조회가 차단되어 있다. 공개 위키와 온톨로지 그래프는 `kb_chunks` raw table을 직접 읽지 않고, 검수된 source-backed surface만 읽어야 한다.

## 현재 확인된 사실

- `agenda_corpus`: anon 공개 read 가능, 현재 173건.
- `kb_chunks`: anon 직접 SELECT 0건. RLS 차단이 정상.
- `kb-search` edge function: service role로 `kb_chunks`를 읽어 `overseas-cases`, `gyeonggi-citizens` 검색 결과를 반환.
- 데이터 인벤토리 기준 기대 source:
  - `overseas-cases`: 1025건
  - `kei-expert-agenda`: 65건
  - `citizen-domestic`: 108건
  - `gyeonggi-citizens`: 경기 OCR/총회 의제, 구조화 및 일부 검색 가능

## 공개 surface 원칙

공개 파일 또는 공개 RPC는 다음 조건을 만족해야 한다.

1. raw `kb_chunks.body` 전체를 무검수로 노출하지 않는다.
2. 공개 가능한 source만 포함한다.
3. 각 항목은 출처와 상태를 가진다.
4. 내부 가안 `/ko/agenda/` 링크를 원문처럼 사용하지 않는다.
5. 그래프 카드에는 검수 완료 또는 source-backed 항목만 링크한다.

## 표준 JSON shape

```json
{
  "id": "kb-000001",
  "slug": "000001-title",
  "title": "공개 제목",
  "source": "kb-agenda-corpus",
  "source_table": "public.kb_chunks",
  "source_kind": "overseas-cases",
  "source_label": "해외 기후의회 권고",
  "doc": "해외:lu",
  "ref_id": "375",
  "category": "에너지·전력",
  "status": "reviewed_public",
  "status_label": "검수 공개",
  "summary": "한 줄 요약",
  "original_excerpt": "공개 가능한 짧은 원문 발췌",
  "href": "/ko/agenda-source/kb/000001-title/",
  "source_backed_href": "/ko/agenda-source/kb/000001-title/",
  "review_status": "reviewed_public",
  "publication_status": "public",
  "keywords": ["재생에너지", "전력"]
}
```

## export 경로

### 권장 1: service role batch export

- 실행 위치: 로컬 또는 CI secret이 있는 trusted runner
- 입력: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`
- 출력: `public/workshop-graph/data/kb-agenda-surface.json`
- 포함 source: `overseas-cases`, `kei-expert-agenda`, `citizen-domestic`, 검수 완료된 `gyeonggi-citizens`

### 권장 2: reviewed public RPC/view

- DB에 `ontology_public.agenda_surface` 또는 `public.reviewed_agenda_surface` view/RPC 생성
- anon은 이 view/RPC만 읽는다.
- raw `kb_chunks`는 계속 RLS 차단.

## 남은 게이트

- service role secret 또는 approved public view/RPC 확정
- 해외 1025건 전체 export count 검증
- raw body 공개 가능성 검토
- source별 제목/본문 중복 QA
- 페이지 디자인 QA
- 그래프 관련도 매칭 QA

## 금지

- anon key로 `kb_chunks` RLS를 우회하려 하지 않는다.
- `kb-search` top-k 결과를 전체 DB export로 간주하지 않는다.
- 검색 결과를 그대로 “검수 완료 위키 페이지”라고 표시하지 않는다.
