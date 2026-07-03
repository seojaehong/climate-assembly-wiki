# 입력 데이터 누락 감사

생성 시각: 2026-07-03T23:23:05.158Z

## 판정

- A조만 들어간 것은 아니다. 통합 워크숍 그래프에는 A조, B조, 통합 텍스트 세션이 함께 들어 있다.
- 모든 데이터가 완전 반영된 것도 아니다. B_t2, 토론4통합, 음성002는 부분 반영 또는 그래프 갭이다.
- 공개 메뉴 A조 라이브 부각 위험: 해소됨
- 결론 도출 과정 그래프 연결: 확인됨

## 검증된 입력 인벤토리

- 원본 파일 노드: 25건
- 음성/문서 세션 노드: 13건
- 텍스트 입력 노드: 6건
- 워크플로 입력 Markdown 파일: 10건
- 통합 워크숍 그래프: 613노드 / 491엣지
- 의제투표 후보: 8건, 응답자: 18명

## 부분 반영 또는 갭

| 항목 | 태그 | 상태 | 전사 | 그래프 노드 | 그래프 상태 |
| --- | --- | --- | --- | ---: | --- |
| 6/14 B조 토론2 | B_t2 | needs_review | transcript_partial | 20 | graph_represented |
| 6/14 토론4 통합 운영 | 토론4통합 | needs_review | transcript_partial | 0 | not_expected_in_current_graph |
| 음성 002 | 음성002 | ui_or_graph_gap | transcript_ready | 0 | not_expected_in_current_graph |

## 공개 메뉴 검증

- 기본 소스: `final-process-to-conclusion-0704`
- 공개 소스: `final-process-to-conclusion-0704`, `final-regulation-decisions-0704`, `final-agenda-decisions-0704`, `workshop-2026-06-13`, `source-coverage-2026-06-13`, `regulation-2026-06-13`
- A조 전용 LIVE 공개 노출: 없음

## 결론

현재 저장소 증거 기준으로는 “전체 반영 상태를 공개하고, 미완/갭 항목을 같이 보여주는 상태”가 정확하다. 따라서 산출물 표현은 완료 선언보다 반영 상태 감사와 결론 도출 경로를 함께 제시하는 방식이어야 한다.

