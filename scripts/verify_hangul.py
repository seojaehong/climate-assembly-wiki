# -*- coding: utf-8 -*-
"""G3 — 한글(HWP)이 실제로 파일을 여는지. **사람이 손으로 돌린다.**

  python scripts/verify_hangul.py --file output/기후시민회의_조별산출물_전체15개조_20260829-1405.hwpx --i-am-here

★★ 에이전트 루프에서 절대 실행하지 말 것.
   이 스크립트는 COM 으로 한글 앱을 띄운다. 앱 창과 보안 대화상자("스크립트가 문서에
   접근하려 합니다")가 떠서 무인 루프가 그 자리에서 멈춘다. 그래서 `--i-am-here` 를
   직접 붙이지 않으면 아무것도 하지 않고 끝난다 — 실수로 켜지는 것을 막는 잠금장치다.

기계가 하는 데까지는 `scripts/verify-hangul.mjs` 가 이미 했다:
  G1 컨테이너 검증(validateHwpx) · G2 되읽기 카드 수·칸 글자 대조.
여기서 사람이 확인하는 것은 **한컴오피스 실물이 여는가**, 그 하나다.
컨테이너가 규격에 맞아도 글꼴·표 서식에서 한글이 투덜대는 경우가 있고, 그건 파서로는
안 잡힌다.

── 수동 절차 (COM 없이도 이게 정본이다) ──────────────────────────────
  1. `export PATH="$HOME/tools/node-v20.18.0-win-x64:$PATH"`
     `node scripts/verify-hangul.mjs --keep` → `output/_verify-hangul-main.hwpx`
  2. 그 파일을 탐색기에서 더블클릭한다.
  3. 눈으로 확인할 것 — 오류·복구 대화상자가 뜨지 않는가 / 표가 4칸(순번·이름·내용·근거)
     으로 보이는가 / 표 데이터 행이 65줄인가 / 「※ 미제출 …」 줄이 보이는가
     (미제출 줄은 `_verify-hangul-silent.hwpx` 쪽에 있다)
  4. 결과를 progress.txt 에 한 줄로 적는다.

이 파이썬 파일은 3번을 자동화하려 할 때만 쓴다. 아래 코드는 pyhwpx 로 문서를 열고
표 개수만 세고 닫는다 — 파일을 고치지 않는다.
"""

import sys

sys.stdout.reconfigure(encoding="utf-8")

import argparse


def main() -> int:
    parser = argparse.ArgumentParser(description="G3 — 한글이 실제로 여는지 (사람이 실행)")
    parser.add_argument("--file", required=True, help="검사할 .hwpx 경로")
    parser.add_argument(
        "--i-am-here",
        action="store_true",
        help="사람이 화면 앞에 있다는 확인. 없으면 아무것도 하지 않는다.",
    )
    args = parser.parse_args()

    if not args.i_am_here:
        print("이 스크립트는 한글 앱 창을 띄운다. 무인 루프에서 돌리면 거기서 멈춘다.")
        print("사람이 화면 앞에 있다면 --i-am-here 를 붙여 다시 실행할 것.")
        print("파일만 눈으로 열어 보는 수동 절차는 이 파일 머리말에 적혀 있다.")
        return 2

    try:
        from pyhwpx import Hwp  # type: ignore
    except ImportError:
        print("pyhwpx 가 없다. `pip install pyhwpx` 후 다시 실행할 것.")
        return 3

    hwp = Hwp(new=True, visible=True)
    try:
        opened = hwp.open(args.file)
        if not opened:
            print(f"FAIL  한글이 열지 못했다: {args.file}")
            return 1
        tables = hwp.get_table_count() if hasattr(hwp, "get_table_count") else None
        print(f"PASS  한글이 열었다: {args.file}")
        print(f"      표 개수 = {tables if tables is not None else '(세지 못함 — 눈으로 확인)'}")
        print("      오류·복구 대화상자가 뜨지 않았는지 눈으로 확인할 것.")
        return 0
    finally:
        # 문서를 고치지 않는다. 저장 없이 닫는다.
        try:
            hwp.clear(option=1)
            hwp.quit()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
