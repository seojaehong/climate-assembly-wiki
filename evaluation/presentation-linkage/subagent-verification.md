# 발표자료 연결 패키지 독립 검증

## 검증 범위

- 작업 위치: `C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터\wiki`
- 검증 대상: `evaluation/presentation-linkage/linkage-evidence-map.json`, `evaluation/presentation-linkage/linkage-storyboard.md`, `evaluation/presentation-linkage/qa-report.json`, `evaluation/presentation-linkage/pptx-text-extract.txt`, `evaluation/presentation-linkage/slide-contact-sheet.png`, `scripts/build_presentation_linkage_package.py`, `scripts/qa_presentation_linkage_package.py`, `tasks/ralph/presentation-linkage/prd.json`, `tasks/ralph/presentation-linkage/progress.txt`
- 추가 대조: 상위 발표덱 `..\10_작업산출물\7.4_발표덱\2026기후시민회의_숙의의제.pptx`를 읽어 22장 구성과 13~15쪽 의제 텍스트를 확인했다.
- 방식: 현재 저장소 산출물 기준 정적 검증. PPTX 재생성, QA 재실행, DB 변경, git 조작은 하지 않았다. 쓰기 범위는 이 보고서와 `subagent-artifact-review.md`로 제한했다.

## 확인 결과

- **공개 메뉴는 A-only/live-A_t1 중심이 아니다.** `linkage-evidence-map.json`의 `summary.a_only_public_menu`는 `false`이고, `public_menu.default`는 `final-process-to-conclusion-0704`다. 공개 source는 6개이며 `has_live_a_t1`은 `false`다. `pptx-text-extract.txt` 2장도 `live-A_t1 노출: False`와 `A-only 위험은 해소`를 같이 표시한다.
- **전체 입력 반영 완료를 과장하지 않는다.** 근거맵의 `summary.all_data_completely_reflected`는 `false`이고, coverage는 원본 파일 25건, workflow Markdown 10건, ready session 10건, partial/review/gap 3건으로 제시된다. `linkage-storyboard.md`와 PPTX 9~10장은 `B_t2`, `토론4통합`, `음성002`를 남은 검증 게이트와 발표 주의 문구로 별도 표시한다.
- **남은 입력 갭 3건은 구체적으로 보존되어 있다.** `B_t2`는 `needs_review`, `transcript_partial`, graph node 20건으로 일부 반영이나 전사 검토가 남았다. `토론4통합`은 `needs_review`, `transcript_partial`, graph node 0건이다. `음성002`는 `transcript_ready`이나 graph node 0건으로 UI/graph gap으로 남아 있다.
- **운영규정 결정은 토론 맥락, 투표 결과, 최종 규정 결론으로 연결된다.** 근거맵과 스토리보드는 운영규정 결정 7건을 각각 토론맥락 건수, 투표 결과, 최종값으로 정리한다. 관련 최종 운영규정 그래프 수치도 32 nodes / 31 edges로 제시된다. 다만 토론 신호는 중간 2건, 약함 5건이므로 “모든 결정의 토론 근거가 강하다”는 표현은 부적절하다.
- **현재 상위 숙의의제 발표덱 기준 의제 3개가 분리되었다.** 근거맵의 `agenda_deck_cross_check`는 상위 덱 존재, 22 slides, 13쪽 교육, 14쪽 시민의식·참여, 15쪽 자원순환·생활폐기물 감축을 확인한다. 독립 PPTX 읽기에서도 같은 13~15쪽 텍스트가 확인되었다.
- **v6 시나리오 차이도 숨기지 않는다.** `agenda_final_slots`는 현재 덱 기준 3개 의제를 별도 슬롯으로 두고, `scenario_variant_slots`는 v6 시나리오를 적응=교육+시민참여 통합, 감축1=자원순환, 감축2=새로운 의제 슬롯/확정명 증거 부족으로 분리한다. PPTX 8장도 “현재 숙의의제 덱 기준 3의제”와 “v6 시나리오의 통합/미확정 슬롯”을 섞지 말라고 명시한다.
- **PPTX QA는 통과 상태다.** `qa-report.json`은 `passed: true`이며 required files 5건 중 누락 0건, slides 10장, text extraction 3720자, visual export 10장을 기록한다. `pptx-text-extract.txt`도 slide 1~10을 포함한다.
- **시각 export/contact sheet도 확인 가능하다.** `slide-export`에는 `slide-01.png`부터 `slide-10.png`까지 10개 파일이 있고, `slide-contact-sheet.png`에는 10개 썸네일이 배치되어 있다.
- **source reference와 count는 구체적이다.** `source_files`는 input coverage, final decision report, public sources, source coverage graph, process graph, final regulation graph, final agenda graph, 현재 숙의의제 덱, 운영규정 v6 시나리오, 의제결과 v6 시나리오를 모두 경로로 남긴다. 핵심 그래프 count는 source coverage 77 nodes / 79 edges, process 21 nodes / 30 edges, final regulation 32 nodes / 31 edges, final agenda 67 nodes / 74 edges다.

## 남은 갭

- **블로커 없음.** 현재 패키지 자체는 요구한 검증 조건을 충족한다.
- **조건부 블로커: “모든 입력 데이터 완전 반영 완료”라고 발표하면 안 된다.** 현재 산출물은 이 표현을 피하고 있지만, `B_t2`, `토론4통합`, `음성002` 3건을 숨기면 검증 판단이 뒤집힌다.
- `markitdown`은 현재 환경에서 `returncode: 1`, `available: false`다. QA는 python-pptx 텍스트 추출 fallback과 slide PNG/contact sheet로 통과했으므로 현 패키지의 블로커는 아니지만, markitdown 변환 자체가 납품 조건이면 별도 재검증이 필요하다.
- `tasks/ralph/presentation-linkage/progress.txt`도 최신 10장 export와 상위 숙의의제 덱 기준 3개 의제 보완사항을 반영한다.
- `agenda_candidates`에는 과거 통합 서사의 흔적이 남아 있어, raw JSON의 후보 목록만 떼어 읽으면 교육+시민참여 통합으로 오해할 수 있다. 발표/보고에는 `agenda_final_slots`와 `scenario_variant_slots`를 함께 써야 한다.

## 최종 판단

현재 발표자료 연결 패키지는 공개 메뉴가 A조/live-A_t1 중심이 아니라는 점, 전체 입력 반영을 과장하지 않는 점, 운영규정 결정을 토론-투표-최종값으로 연결한 점, 그리고 상위 숙의의제 덱의 3개 의제를 v6 통합 시나리오와 분리한 점을 모두 충족한다. 블로커는 없으며, 남은 3개 입력 갭과 v6 감축2 미확정 슬롯을 발표 시 그대로 유지하는 조건에서 검증 통과로 판단한다.
