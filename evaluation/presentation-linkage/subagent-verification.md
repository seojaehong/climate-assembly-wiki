# 발표자료 연결 독립 검증

## 검증 범위

- 작업 위치: `C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터\wiki`
- 검증 대상: `public/workshop-graph/sources.json`, `public/workshop-graph/data/source-coverage-2026-06-13.json`, `public/workshop-graph/data/final-process-to-conclusion-0704.json`, `public/workshop-graph/data/final-regulation-decisions-0704.json`, `public/workshop-graph/data/final-agenda-decisions-0704.json`
- 대조 산출물: `evaluation/input-coverage/input-coverage-report.json`, `evaluation/input-coverage/input-coverage-audit.md`, `evaluation/ontology-final-decisions/final-decision-ontology-report.json`, `docs/graph-source-coverage-audit-2026-06-25.md`
- 방식: 현재 저장소 산출물 기준 정적 검증. 재전사, DB 변경, 다른 파일 수정은 하지 않았다.

## 확인 결과

- 공개 메뉴는 더 이상 A조 전용/live A조 데이터를 기본으로 강조하지 않는다. `public/workshop-graph/sources.json`의 기본 소스는 `final-process-to-conclusion-0704`이고, 공개 소스는 6개다: `final-process-to-conclusion-0704`, `final-regulation-decisions-0704`, `final-agenda-decisions-0704`, `workshop-2026-06-13`, `source-coverage-2026-06-13`, `regulation-2026-06-13`. `live-A_t1` 또는 A조 전용 live 소스는 현재 메뉴에 없고, `public/workshop-graph` 아래에도 해당 데이터 파일은 남아 있지 않다.
- 입력 커버리지 산출물은 주요 입력 가족을 별도로 표현한다. `source-coverage-2026-06-13.json`은 77노드 / 79엣지, 원본 파일 25건, 이슈 3건을 담고 있다. `input-coverage-report.json` 기준으로 음성/문서 세션은 13건, 텍스트 입력은 6건, 워크플로 입력 Markdown은 10건이다.
- 통합 워크숍 그래프는 A조만이 아니다. `workshop-2026-06-13.json`은 613노드 / 491엣지이며 A조 세션(`A_t21`, `A_t22`, `A_t23`, `OA_t1`, `DA_t2`), B조 세션(`B_t1`, `B_t2`, `B_t3`, `OB_t1`, `DB_t2`), 통합/발표/교육 세션(`OZ_t1`, `DZ_t2`, `발표`, `정의전환`, `환경4조`)을 함께 포함한다.
- 결론 도출 경로는 별도 그래프로 연결되어 있다. `final-process-to-conclusion-0704.json`은 21노드 / 30엣지이고, 핵심 흐름은 `원본자료 -> 전사·텍스트 -> 통합 워크숍 그래프 -> 7.4 투표·발표자료 -> 최종 운영규정·의제 결론`이다. 엣지도 `mapsTo`, `narrowsTo`, `resolves`, `supports`로 이 흐름을 구분한다.
- 운영규정 결정 연결은 명시적이다. `final-regulation-decisions-0704.json`은 32노드 / 31엣지이고, 최종 운영규정 결정 7건 모두에 투표 근거 엣지 1개, 최종 세트의 확정 엣지 1개, 토론 맥락 지지 엣지가 붙어 있다. 다만 토론 맥락 신호는 2건이 중간, 5건이 약함으로 기록되어 있어 “모든 결정의 토론 근거가 강하다”고 표현하면 과장이다.
- 의제 결정/후보 연결도 명시적이다. `final-agenda-decisions-0704.json`은 67노드 / 74엣지이고, 의제 8건 모두에 투표 근거 엣지와 토론 맥락 지지 엣지가 있다. 처리 상태는 발표 시나리오상 선정 2건, 선정 의제로 통합 1건, 후보로 논의됨 5건이다. 따라서 “후보별 논의 맥락은 있었다”는 말은 가능하지만, 후보 8건 모두를 최종 선정 의제처럼 말하면 안 된다.
- “끝장토론이 곧바로 결론을 만들었다”가 아니라 “토론이 기준과 후보를 만들고, 이후 투표·발표자료·통합 로직이 최종 결론을 고정했다”는 설명은 현재 산출물로 지지된다. 근거는 `final-process-to-conclusion-0704.json`의 `stage-workshop-graph -> stage-final-votes -> stage-final-conclusions` 경로와, 운영규정/의제 최종 세트의 `ctx_* -> decision_*`, `decision_* -> vote_*`, `final-set -> decision_*` 연결이다.

## 남은 갭

- **블로커: “모든 입력 데이터 완전 반영 완료”라고 발표하는 것은 현재 산출물과 맞지 않는다.** `input-coverage-report.json`의 `allDataCompletelyReflected`는 `false`이고, `partialOrGapSessions`는 3건이다.
- `B_t2`(`6/14 B조 토론2`): 전사 상태가 `transcript_partial`이고 chunk/json은 1/5다. 그래프에는 20노드가 있어 일부 반영은 되었지만, 상위 txt/srt가 0바이트로 기록되어 재확인이 필요하다.
- `토론4통합`(`6/14 토론4 통합 운영`): 전사 상태가 `transcript_partial`, chunk/json은 0/10, 그래프 노드는 0이다. 운영규정 최종 결정 그래프는 `06b_조숙의_통합_토론4.md` 및 의결표를 근거로 쓰지만, 원본 음성 전사-그래프 연결은 아직 미완으로 남는다.
- `음성002`: 전사 상태는 `transcript_ready`, chunk/json은 9/9지만 그래프 노드는 0이다. 현재 공개 그래프 또는 UI에서 별도 연결 상태가 확인되지 않는다.
- 조건부 운영 투표 입력(`public/0704-admin/decision-votes-report.json`의 V0/V1A/V1B)은 `input-coverage-report.json`에서 응답 수 0으로 잡혀 있다. 현재 최종 결론 근거로 쓰지 않는 판단은 타당하지만, 발표자료가 이 조건부 투표를 근거로 말하면 추가 확인이 필요하다.

## 발표자료 반영 권고

- 첫 장에서는 “A조 live 샘플”이 아니라 `전체 과정 -> 최종 결론`을 기본 진입점으로 보여준다. 메뉴 검증 결과는 “A조 전용 공개 노출 없음”으로 말해도 된다.
- 데이터 반영 상태는 “원본 25건, 음성/문서 세션 13건, 텍스트 입력 6건, 워크플로 Markdown 10건을 커버리지 감사에 올렸고, 통합 그래프는 613노드 / 491엣지”라고 설명한다.
- 단, 같은 장 또는 각주에 `B_t2`, `토론4통합`, `음성002` 3건은 재확인/그래프 갭으로 남아 있다고 명시한다.
- 결론 서사는 “토론이 기준과 후보를 형성했고, 7.4 투표·발표자료·통합 로직이 최종 결론을 확정했다”로 잡는 것이 현재 온톨로지 구조와 가장 잘 맞다.
- 운영규정은 “최종 결정 7건 모두 투표 근거와 토론 맥락이 연결됨. 다만 일부 토론 맥락은 약함”으로 표현한다.
- 의제는 “선정 2건, 통합 1건, 후보 논의 5건”으로 구분한다. 후보 전체를 최종 선정처럼 묶지 말고, 통합된 후보는 `integrates` 관계로 설명한다.
