# 발표자료 연결 패키지 최종 산출물 리뷰

## 검토 결과

- 블로커 없음.
- 입력데이터 반영 범위는 과장하지 않는다. `tasks/ralph/presentation-linkage/prd.json`, `evaluation/presentation-linkage/linkage-evidence-map.json`, `evaluation/presentation-linkage/linkage-storyboard.md`, `evaluation/presentation-linkage/pptx-text-extract.txt` 모두 `B_t2`, `토론4통합`, `음성002`를 남은 gap으로 보존하고, `all_data_completely_reflected: false` 및 "완전 반영 완료라고는 말하지 않는다"는 표현을 유지한다.
- 공개 메뉴/default가 A-only 또는 live-A_t1 중심이 아니라는 점이 명확하다. 근거맵은 기본값을 `final-process-to-conclusion-0704`, 공개 source를 6개, `has_live_a_t1: false`로 기록했고, 스토리보드와 PPTX 텍스트도 `A-only` 위험 해소와 별도 gap 유지를 함께 말한다.
- 운영규정 결정 연결은 요구사항을 충족한다. 근거맵과 스토리보드는 운영규정 결정 7건을 토론맥락 건수, 투표 결과, 최종 규정 결론으로 연결하고, 검증 보고서도 최종 운영규정 그래프의 투표 근거와 토론 맥락 엣지를 확인한다.
- 의제 결과 연결은 과장 없이 구성되어 있다. 의제는 후보/기준/투표/통합/최종 슬롯 흐름으로 설명되며, 감축2 세 번째 슬롯은 `새로운 의제 슬롯`, `확정명 증거 부족`, `현재 repo 증거상 확정명 없음`으로 남겨 잘못된 확정명을 만들지 않는다.
- 구체 수치와 source reference가 포함되어 있다. 패키지는 원본 파일 25건, coverage 77 nodes / 79 edges, ready sessions 10건, partial/gap 3건, 운영규정 결정 7건, 의제 후보 8건, 최종 슬롯 3건, PPTX 9장을 제시하며, `source_files`에 `input-coverage-report.json`, `final-decision-ontology-report.json`, `sources.json`, `final-process-to-conclusion-0704.json`, `final-regulation-decisions-0704.json`, `final-agenda-decisions-0704.json` 등을 명시한다.
- PPTX QA는 통과 상태다. `evaluation/presentation-linkage/qa-report.json`은 `passed: true`, 필수 파일 누락 0건, 추출 텍스트 3214자, 시각 export 9장을 기록한다. `markitdown`은 미설치로 실패했지만 `markitdown-check.log`와 QA notes에 제한이 남아 있고, `python-pptx` 텍스트 추출 fallback 및 slide export/contact sheet로 보완되어 있다.

## 문제/리스크

- 블로커는 없다. 다만 `subagent-verification.md`가 지적한 것처럼 "모든 입력 데이터 완전 반영 완료"라고 발표하면 블로커가 된다. 현재 생성 PPTX와 스토리보드는 이 표현을 피하고 3개 gap을 표시하므로 요구사항 기준으로는 해소되어 있다.
- 운영규정 토론맥락은 연결 자체는 확인되지만 강도가 균일하지 않다. 일부 항목은 토론맥락 신호가 약하므로 "모든 결정의 토론 근거가 강하다"는 식의 문구는 피해야 한다.
- `markitdown` 기반 독립 변환은 현재 환경에서 사용할 수 없다. QA fallback은 명시되어 있고 통과했지만, 향후 배포 기준이 markitdown 변환 자체를 요구하면 설치 후 재검증이 필요하다.
- 근거맵 내부에는 후보별 평가값 필드가 남아 있다. 공개 발표물인 스토리보드/PPTX는 순위와 건수 중심이라 괜찮지만, 근거맵 내용을 대외 문서로 복사할 때는 해당 필드를 그대로 노출하지 않도록 주의가 필요하다.

## 최종 판단

현재 발표자료 연결 패키지는 제시된 6개 요구사항을 충족한다. 특히 A-only 오해 해소와 전체 반영 미완료 gap 보존을 동시에 처리했고, 운영규정/의제 결론을 토론-투표-통합-최종 슬롯 흐름으로 설명하면서 unresolved 감축2 의제를 허위 확정하지 않는다. QA 산출물도 통과했고 fallback 제한도 문서화되어 있으므로, 남은 gap을 발표 시 그대로 유지한다는 조건에서 최종 사용 가능으로 판단한다.
