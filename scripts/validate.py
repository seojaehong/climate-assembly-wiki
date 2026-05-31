#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, yaml, glob, os
sys.stdout.reconfigure(encoding='utf-8')

root = 'wiki/content/ko'
errs = []
ids = []
mismatches = []

for path in sorted(glob.glob(f'{root}/**/*.md', recursive=True)):
    path_n = path.replace(os.sep, '/')
    if path_n.endswith('/agenda/00-dummy.md'):
        continue  # owned by subagent A
    try:
        with open(path, 'r', encoding='utf-8') as f:
            txt = f.read()
        parts = txt.split('---', 2)
        assert len(parts) >= 3, f"no frontmatter in {path}"
        fm = yaml.safe_load(parts[1])
        assert fm is not None, "empty fm"
        base = os.path.basename(path).replace('.md', '')
        if 'slug' in fm:
            if '/agenda/' in path_n:
                expected = f"{fm['id']:02d}-{fm['slug']}"
                if base != expected:
                    mismatches.append((path, base, expected))
            else:
                # session filenames are 2026-05-28-lec1-park-chan == slug
                # doc filenames are slug
                if base != fm['slug']:
                    mismatches.append((path, base, fm['slug']))
        if 'id' in fm:
            ids.append(fm['id'])
        # required fields per type
        if '/agenda/' in path_n:
            for k in ('id', 'slug', 'title', 'category', 'status', 'sessions',
                     'related_agendas', 'ministries', 'international_cases',
                     'license', 'last_updated', 'translations'):
                assert k in fm, f"missing {k} in {path}"
            assert fm['category'] in ('일반-의제', '메타-의제', '실행-의제'), f"bad category in {path}: {fm['category']}"
            assert fm['status'] == 'proposed', f"bad status in {path}"
        elif '/session/' in path_n:
            for k in ('date', 'slug', 'title', 'session_type', 'agendas_discussed',
                     'license', 'last_updated', 'translations'):
                assert k in fm, f"missing {k} in {path}"
        elif '/doc/' in path_n:
            for k in ('slug', 'title', 'doc_type', 'order', 'license',
                     'last_updated', 'translations'):
                assert k in fm, f"missing {k} in {path}"
    except Exception as e:
        errs.append((path, str(e)))

# glossary
gpath = f'{root}/glossary/terms.yaml'
try:
    with open(gpath, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    assert isinstance(data, list) and len(data) >= 10
    keys = [d['key'] for d in data]
    assert len(set(keys)) == len(keys)
    for d in data:
        for lang in ('ko', 'en', 'ja', 'zh', 'es'):
            assert lang in d, f"glossary entry {d.get('key')} missing {lang}"
    print(f"glossary: {len(data)} terms OK")
except Exception as e:
    errs.append((gpath, str(e)))

print(f"ids: count={len(ids)} unique={len(set(ids))} range={min(ids) if ids else None}~{max(ids) if ids else None}")
print(f"slug/filename mismatches: {mismatches}")
print(f"errors: {errs}")
if not errs and len(set(ids)) == len(ids) == 15 and not mismatches:
    print("PASS")
    sys.exit(0)
else:
    print("FAIL")
    sys.exit(1)
