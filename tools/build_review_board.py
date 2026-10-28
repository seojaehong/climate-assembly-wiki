"""10/28 권고 문구 검토 화면 빌더 — 카드 JSON + 템플릿 → public/r-phj4az8h2j8s/index.html

카드 원천 = 권고카드 v3(70장) hwpx 에서 뽑은 cards_v3.json
  (OneDrive 10_작업산출물/2026-10-28_권고문구_검토화면/extract_cards.py)
의견은 Supabase rv_* RPC 로만 오간다. 암호는 화면에 없다(서버 rv_config 의 SHA-256 과 대조).
공개 키는 브라우저용 publishable 키라 저장소에 있어도 된다.

  python tools/build_review_board.py <cards_v3.json>
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SB_URL = 'https://pleyuknjnprsckssxvrh.supabase.co'
SB_KEY = 'sb_publishable_OVwo9zs5i6'  # 앞부분 — 아래에서 0704-supabase-vote 페이지의 전체 키를 읽는다
OUT = ROOT / 'public' / 'r-phj4az8h2j8s' / 'index.html'


def publishable_key():
    import re
    src = (ROOT / 'public' / '0704-supabase-vote' / 'index.html').read_text(encoding='utf-8')
    k = re.search(r'sb_publishable_[A-Za-z0-9_-]+', src).group(0)
    assert k.startswith(SB_KEY)
    return k


def main():
    cards = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))['cards']
    assert len(cards) == 70
    tpl = (ROOT / 'tools' / 'review_board_template.html').read_text(encoding='utf-8')
    html = (tpl.replace('__SB_URL__', SB_URL).replace('__SB_KEY__', publishable_key())
               .replace('__CARDS__', json.dumps(cards, ensure_ascii=False)))
    assert '__' not in html.split('<script>')[1].split('const FIELDS')[0]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print(OUT, len(html.encode()), 'bytes')


main()
