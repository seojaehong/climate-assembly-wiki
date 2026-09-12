"""Validate local deck coverage and create visual review sheets."""
import argparse
import json
import re
import zipfile
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    directory = args.directory
    files = sorted((directory / 'rendered').glob('*.PNG'), key=lambda p: int(re.search(r'\d+', p.stem).group()))
    coverage = json.loads((directory / 'coverage.json').read_text(encoding='utf-8'))
    render = json.loads((directory / 'render-validation.json').read_text(encoding='utf-8-sig'))
    if len(files) != coverage['totalSlides']:
        raise ValueError(f'Render count mismatch: {len(files)}')
    for start in range(0, len(files), 6):
        sheet = Image.new('RGB', (1600, 1392), '#dbe7ee')
        draw = ImageDraw.Draw(sheet)
        for index, file in enumerate(files[start:start + 6]):
            with Image.open(file) as original:
                thumb = ImageOps.contain(original.convert('RGB'), (800, 450))
                x, y = (index % 2) * 800, (index // 2) * 464
                sheet.paste(thumb, (x, y + 14))
                draw.text((x + 5, y), f'Slide {start + index + 1}', fill='black')
        sheet.save(directory / f'review-{start // 6 + 1:02d}.jpg', quality=94)
    with zipfile.ZipFile(directory / '0912_분과별_추가주제_회의용.pptx') as archive:
        fonts = [name for name in archive.namelist() if name.startswith('ppt/fonts/')]
    result = {'topics': len(coverage['agendas']), 'slides': len(files), 'embeddedFontParts': len(fonts), 'overflowCandidates': len(render['overflow']), 'divisionCounts': {name: sum(a['subgroup'] == name for a in coverage['agendas']) for name in ['1분과', '2분과', '3분과']}}
    (directory / 'report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
