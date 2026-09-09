from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree

# 정본 = 「20260829 시민참여단 참석명단_2.0.hwpx」(2026-08-27 수신).
# 직전 정본은 7/4 명단(7D486447…)이었고 8/29 2.0에서 숙의 명부가 174→181명으로 바뀌었다
# (드롭 3명 제외 + 신규 11명 편입, 3분과 4조 이명례의 연번 160→143 정정 포함).
EXPECTED_SOURCE_HASH = "7AB0A88092A28D70BD77D695B33C9E9F067F91BF155829534438F3BDEC5080DF"
EXPECTED_GROUP_COUNTS = {
    "1분과 1조": 12,
    "1분과 2조": 12,
    "1분과 3조": 13,
    "1분과 4조": 12,
    "1분과 5조": 12,
    "2분과 1조": 9,
    "2분과 2조": 13,
    "2분과 3조": 13,
    "2분과 4조": 12,
    "2분과 5조": 13,
    "3분과 1조": 9,
    "3분과 2조": 13,
    "3분과 3조": 13,
    "3분과 4조": 13,
    "3분과 5조": 12,
}

# 명부 총원은 조별 인원의 합으로 둔다 — 숫자를 두 곳에 적어두면 한쪽만 고쳐진다.
EXPECTED_TOTAL = sum(EXPECTED_GROUP_COUNTS.values())


@dataclass(frozen=True)
class RosterRow:
    official_id: str
    name: str
    team_name: str
    attendance_status: str


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _cell_text(cell: ElementTree.Element) -> str:
    parts = [
        (node.text or "").strip()
        for node in cell.iter()
        if _local_name(node.tag) == "t" and (node.text or "").strip()
    ]
    return " ".join(parts)


_TEAM_HEADER = re.compile(r"^(\d)\s*분과\s*(\d+)\s*조")


def _team_name(cell: str) -> str:
    """
    머리 칸에서 숙의 조 이름을 읽는다. 「1분과 1조 (11명)」·「2분과 1조9명」처럼
    2.0 명단은 조 제목에 참석 인원을 덧붙였고, 7/4 명단에는 「(청소년)」이 붙기도 했다.
    조 이름만 남기고 그 뒤 꼬리는 전부 버린다. 숙의 조가 아니면 빈 문자열.
    """
    match = _TEAM_HEADER.match(cell.strip())
    if not match:
        return ""
    return f"{match.group(1)}분과 {int(match.group(2))}조"


def _source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def parse_roster(path: Path, expected_hash: str = EXPECTED_SOURCE_HASH) -> list[RosterRow]:
    actual_hash = _source_hash(path)
    if actual_hash != expected_hash.upper():
        raise ValueError(f"source hash mismatch: expected {expected_hash.upper()}, got {actual_hash}")

    with zipfile.ZipFile(path) as package:
        section = ElementTree.fromstring(package.read("Contents/section0.xml"))

    # 표 인덱스를 고정 슬라이스로 잡지 않는다 — 명단이 늘면 표 개수가 바뀌어 조용히 잘린다.
    # 대신 전 표를 훑되 「N분과 M조」 형태의 머리 칸이 나올 때만 그 조를 열어 담는다.
    # 이 정규식이 기획분과(「기획분과 ( A )조」)를 자연히 걸러낸다 — DB에는 숙의 15개 조만 있다.
    tables = [node for node in section.iter() if _local_name(node.tag) == "tbl"]
    rows: list[RosterRow] = []
    current_team = ""
    for table in tables:
        table_rows = [node for node in table if _local_name(node.tag) == "tr"]
        for table_row in table_rows:
            cells = [_cell_text(node) for node in table_row if _local_name(node.tag) == "tc"]
            if not cells:
                continue
            team = _team_name(cells[0])
            if team and len(cells) >= 6:
                current_team = team
                official_id, name, attendance_status = cells[1], cells[2], cells[5]
            elif current_team and len(cells) >= 5 and cells[0].strip().isdigit():
                official_id, name, attendance_status = cells[0], cells[1], cells[4]
            else:
                continue
            rows.append(
                RosterRow(
                    official_id=official_id.strip(),
                    name=name.strip(),
                    team_name=current_team,
                    attendance_status=attendance_status.strip(),
                )
            )

    validate_roster(rows)
    return rows


def attending_rows(rows: Iterable[RosterRow]) -> list[RosterRow]:
    """Return rows not explicitly marked absent in the canonical attendance sheet."""
    absent_markers = ("미참석", "결석")
    return [
        row
        for row in rows
        if not any(marker in row.attendance_status for marker in absent_markers)
    ]


def read_excluded_official_ids(path: Path) -> list[str]:
    """Read one official ID per UTF-8 line without accepting ambiguous CSV input."""
    excluded_ids = [
        line.strip()
        for line in path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]
    if not excluded_ids:
        raise ValueError("excluded official ID file is empty")
    if any("," in official_id or "\t" in official_id for official_id in excluded_ids):
        raise ValueError("excluded official ID file must contain one ID per line")
    if len(set(excluded_ids)) != len(excluded_ids):
        raise ValueError("duplicate excluded official ID")
    return excluded_ids


def exclude_rows_by_official_id(
    rows: Iterable[RosterRow], excluded_ids: Iterable[str]
) -> list[RosterRow]:
    """Exclude an explicitly approved ID set and reject unknown or duplicate IDs."""
    selected_rows = list(rows)
    requested = list(excluded_ids)
    if len(set(requested)) != len(requested):
        raise ValueError("duplicate excluded official ID")
    available = {row.official_id for row in selected_rows}
    unknown = sorted(set(requested) - available)
    if unknown:
        raise ValueError(
            f"excluded official ID not found in selected roster: {', '.join(unknown)}"
        )
    excluded = set(requested)
    return [row for row in selected_rows if row.official_id not in excluded]


def group_counts(rows: Iterable[RosterRow]) -> dict[str, int]:
    return dict(Counter(row.team_name for row in rows))


def validate_roster(rows: list[RosterRow]) -> None:
    if len(rows) != EXPECTED_TOTAL:
        raise ValueError(f"expected {EXPECTED_TOTAL} roster rows, got {len(rows)}")
    if group_counts(rows) != EXPECTED_GROUP_COUNTS:
        raise ValueError(f"group counts mismatch: {group_counts(rows)}")
    if any(not row.official_id or not row.name for row in rows):
        raise ValueError("blank official_id or name")
    if len({row.official_id for row in rows}) != len(rows):
        raise ValueError("duplicate official_id")
    if len({row.name for row in rows}) != len(rows):
        raise ValueError("duplicate name")


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_seed_sql(rows: list[RosterRow], session_slug: str, source_hash: str) -> str:
    values = ",\n".join(
        f"    ({_sql_literal(row.official_id)}, {_sql_literal(row.name)}, {_sql_literal(row.team_name)})"
        for row in rows
    )
    slug = _sql_literal(session_slug)
    source = _sql_literal(source_hash.upper())
    total = len(rows)
    team_count = len(group_counts(rows))
    official_ids = ", ".join(_sql_literal(row.official_id) for row in rows)
    return f"""begin;

do $preflight$
declare
  target_session_id uuid;
  target_org_id uuid;
begin
  select id, org_id into target_session_id, target_org_id
  from climate_vote.session where slug = {slug};
  if target_session_id is null or target_org_id is null then
    raise exception 'session not found: %', {slug};
  end if;
  -- 다른 source_hash가 이미 있어도 막지 않는다. 명단은 개정되며(7/4 → 8/29 1.0 → 2.0)
  -- 개정본을 넣지 못하면 신규 편입자가 당일 출석부에 뜨지 않는다.
  -- 무엇으로 덮었는지는 아래 attendance_audit_log의 roster.import 기록으로 남는다.
end
$preflight$;

with source_rows(official_id, name, team_name) as (
  values
{values}
), target_session as (
  select id, org_id from climate_vote.session where slug = {slug}
), upserted_members as (
  insert into climate_vote.assembly_member (org_id, official_id, name, active, source_hash)
  select s.org_id, r.official_id, r.name, true, {source}
  from source_rows r cross join target_session s
  on conflict (org_id, official_id) where org_id is not null do update
    set name = excluded.name, active = true, source_hash = excluded.source_hash,
        updated_at = now()
  returning id, org_id, official_id
)
insert into climate_vote.team_assignment (session_id, team_id, member_id, active, org_id)
select ts.id, t.id, m.id, true, ts.org_id
from source_rows r
join target_session ts on true
join upserted_members m on m.org_id = ts.org_id and m.official_id = r.official_id
join climate_vote.team t on t.session_id = ts.id and t.name = r.team_name
on conflict (session_id, member_id) do update
  set team_id = excluded.team_id, active = true, org_id = excluded.org_id, updated_at = now();

-- 개정 명단에서 빠진 사람(드롭·교체)의 배정을 내린다.
-- 그대로 두면 hq_teams 인원과 정족수 산정이 실제보다 커진다.
-- 행을 지우지 않고 active=false로 두어 출석 기록·감사 로그의 참조를 보존한다.
update climate_vote.team_assignment ta
   set active = false, updated_at = now()
  from climate_vote.session s
 where s.id = ta.session_id
   and s.slug = {slug}
   and ta.active
   and not exists (
     select 1 from climate_vote.assembly_member m
      where m.id = ta.member_id
        and m.official_id in ({official_ids})
   );

insert into climate_vote.attendance (assignment_id, base_status, org_id)
select ta.id, 'unconfirmed', ta.org_id
from climate_vote.team_assignment ta
join climate_vote.session s on s.id = ta.session_id
where s.slug = {slug} and ta.active
on conflict (assignment_id) do nothing;

insert into climate_vote.attendance_audit_log
  (session_id, action, before_value, after_value, actor_scope, actor_label, org_id)
select s.id, 'roster.import', null,
  jsonb_build_object('source_hash',{source},'member_count',{total},'team_count',{team_count}),
  'import', '고정 HWPX 명단 가져오기', s.org_id
from climate_vote.session s
where s.slug={slug}
  and not exists (
    select 1 from climate_vote.attendance_audit_log l
    where l.session_id=s.id and l.action='roster.import'
      and l.after_value->>'source_hash'={source}
  );

do $verify$
declare
  roster_count integer;
  assignment_count integer;
  attendance_count integer;
begin
  select count(*) into roster_count
  from climate_vote.assembly_member m
  join climate_vote.session s on s.org_id = m.org_id
  where s.slug = {slug} and m.source_hash = {source};
  select count(*) into assignment_count
  from climate_vote.team_assignment ta
  join climate_vote.session s on s.id = ta.session_id
  where s.slug = {slug} and ta.active;
  select count(*) into attendance_count
  from climate_vote.attendance a
  join climate_vote.team_assignment ta on ta.id = a.assignment_id
  join climate_vote.session s on s.id = ta.session_id
  where s.slug = {slug} and ta.active;
  if roster_count <> {total} or assignment_count <> {total} or attendance_count <> {total} then
    raise exception 'roster verification failed: members %, assignments %, attendance %',
      roster_count, assignment_count, attendance_count;
  end if;
end
$verify$;

commit;"""


def build_report(
    rows: list[RosterRow],
    path: Path,
    source_hash: str,
    *,
    source_item_count: int | None = None,
    expected_total: int = EXPECTED_TOTAL,
    attendance_only: bool = False,
) -> dict[str, object]:
    return {
        "source_file": path.name,
        "source_sha256": source_hash,
        "item_count": len(rows),
        "expected_total": expected_total,
        "source_item_count": source_item_count if source_item_count is not None else len(rows),
        "team_count": len(group_counts(rows)),
        "group_counts": group_counts(rows),
        "blank_id_count": sum(not row.official_id for row in rows),
        "blank_name_count": sum(not row.name for row in rows),
        "duplicate_id_count": len(rows) - len({row.official_id for row in rows}),
        "duplicate_name_count": len(rows) - len({row.name for row in rows}),
        "excluded_planning_and_advisory": True,
        "historical_notes_imported": False,
        "attendance_only": attendance_only,
        "status": "verified",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and seed the fixed climate assembly HWPX roster.")
    parser.add_argument("--file", type=Path, required=True)
    parser.add_argument("--expected-hash", default=EXPECTED_SOURCE_HASH)
    parser.add_argument("--session-slug", default="0829-deliberation")
    parser.add_argument("--report", type=Path, default=Path("evaluation/report.json"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--attendance-only", action="store_true")
    parser.add_argument(
        "--exclude-official-ids-file",
        type=Path,
        help="UTF-8 text file containing one approved official ID per line",
    )
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--print-sql", action="store_true")
    parser.add_argument("--sql-output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.dry_run and not args.print_sql and args.sql_output is None:
        raise ValueError("choose --dry-run, --print-sql, or --sql-output")
    source_rows = parse_roster(args.file, args.expected_hash)
    rows = attending_rows(source_rows) if args.attendance_only else source_rows
    if args.exclude_official_ids_file is not None:
        rows = exclude_rows_by_official_id(
            rows,
            read_excluded_official_ids(args.exclude_official_ids_file),
        )
    expected_count = args.expected_count if args.expected_count is not None else EXPECTED_TOTAL
    if len(rows) != expected_count:
        raise ValueError(f"expected {expected_count} selected roster rows, got {len(rows)}")
    source_hash = _source_hash(args.file)
    if args.dry_run:
        report = build_report(
            rows,
            args.file,
            source_hash,
            source_item_count=len(source_rows),
            expected_total=expected_count,
            attendance_only=args.attendance_only,
        )
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"verified {len(rows)} members across {len(group_counts(rows))} teams")
        print(f"report: {args.report}")
    if args.print_sql:
        print(build_seed_sql(rows, args.session_slug, source_hash))
    if args.sql_output is not None:
        args.sql_output.parent.mkdir(parents=True, exist_ok=True)
        args.sql_output.write_text(
            build_seed_sql(rows, args.session_slug, source_hash) + "\n",
            encoding="utf-8",
        )
        print(f"SQL written as UTF-8: {args.sql_output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, zipfile.BadZipFile, ElementTree.ParseError) as error:
        print(f"attendance roster import failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
