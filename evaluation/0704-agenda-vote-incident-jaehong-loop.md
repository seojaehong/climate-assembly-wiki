# 0704 추가의제 투표 결과 덮어쓰기 사고 정리

## 결론

이번 사고의 직접 원인은 발표/공지에 사용한 최종 결과 스냅샷과 Google Form 기반 실시간 재집계 결과를 같은 `Scores` 시트로 운용한 것이다.

공식 공지 기준 결과는 아래 값이었다.

| 순위 | 의제 | 점수 |
|---:|---|---:|
| 1 | (A조) 기업 인센티브 감축방안 | 3.60 |
| 2 | (B조) 지역맞춤 탄소절감 방안 | 3.53 |
| 3 | (A조) 재생에너지 생산·사용 확대 | 3.47 |
| 4 | (B조) 재건축·리모델링 탄소감축 | 2.87 |

이후 `scripts/refresh-0704-agenda-vote.ps1`를 다시 실행하면서 현재 Form 응답 기준 재집계값이 같은 `Scores` 시트에 덮어써졌다. 그 결과 화면 값이 일시적으로 달라졌다.

## 영향

- public result URL이 mutable sheet를 직접 읽고 있었기 때문에, 확정 후 재집계가 곧바로 발표 화면 변경으로 이어졌다.
- 다행히 순위 변화는 없었지만, 발표/공지된 점수와 화면 점수가 달라질 수 있는 상태였다.
- 이 문제는 투표 로직 자체보다 운영 상태 전환, 즉 live에서 final로 넘어가는 freeze 단계가 빠진 것이 핵심이다.

## 원인 분해

1. `Scores`가 live aggregation과 public final output을 겸했다.
2. refresh script에 final overwrite guard가 없었다.
3. 발표/공지 직후 final snapshot JSON이나 final sheet 복사본을 별도 source of truth로 잠그지 않았다.
4. 화면 검증은 "현재 보이는 값"만 봤고, "공지된 값과 일치하는지"를 별도 체크하지 않았다.

## 복구 상태

- `Scores` 시트를 공지 기준 값으로 복구했다.
- live result page에서 `3.60, 3.53, 3.47, 2.87` 표시를 확인했다.
- 4위 rank label 표시와 tie-safe rank logic을 배포했다.
- 공식 스냅샷은 `evaluation/0704-agenda-vote-final-snapshot.json`에 기록했다.

## 재홍루프 재발방지 규칙

다음 운영부터 투표 화면은 아래 4단계를 통과해야 public final로 인정한다.

1. Live collection
   - Form 응답은 `Scores_Live` 또는 `FormResponses`에만 갱신한다.

2. Final freeze
   - 발표/공지 직전 `Scores_Final` 또는 `final-snapshot.json`을 생성한다.
   - 이 시점 이후 결과 화면 기본값은 live sheet가 아니라 final snapshot만 읽는다.

3. Guarded overwrite
   - final output을 덮어쓰는 스크립트는 기본 실행으로는 막는다.
   - `--ForceFinalOverwrite` 같은 명시 옵션과 사용자 확인이 있어야 한다.

4. Announcement check
   - 발표/공지 문구, result page, final snapshot 값을 모두 비교한다.
   - 값과 순위가 일치하지 않으면 배포 또는 캡처를 중단한다.

## 다음 구현 권고

- `scripts/refresh-0704-agenda-vote.ps1`를 live-only default로 바꾼다.
- 별도 `scripts/finalize-0704-agenda-vote.ps1`를 만들어 final sheet/snapshot을 생성한다.
- `agenda-vote-0704` 결과 페이지는 기본적으로 final snapshot URL 또는 `Scores_Final`을 읽게 한다.
- 관리자 페이지에 "라이브 갱신"과 "최종 확정" 버튼을 분리한다.

## 운영 메모

이번 사고는 "값을 잘못 계산했다"가 아니라 "확정값을 고정하지 않았다"가 핵심이다. 앞으로는 사람의 최종 판단이 들어간 순간부터 데이터는 live가 아니라 final artifact로 승격되어야 한다.
