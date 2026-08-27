from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("import-attendance-roster.py")
# 정본은 8/29 참석명단 2.0. 7/4 명단(174명)이 아니라 이쪽이 당일 출석부의 근거다.
SOURCE_PATH = Path(__file__).resolve().parents[2] / "00_입력자료" / "20260829 시민참여단 참석명단_2.0.hwpx"
EXPECTED_HASH = "7AB0A88092A28D70BD77D695B33C9E9F067F91BF155829534438F3BDEC5080DF"
EXPECTED_TOTAL = 181


def load_module() -> object:
    spec = importlib.util.spec_from_file_location("import_attendance_roster", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load parser: {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class AttendanceRosterParserTest(unittest.TestCase):
    def test_fixed_hwpx_roster(self) -> None:
        module = load_module()
        rows = module.parse_roster(SOURCE_PATH, EXPECTED_HASH)
        counts = module.group_counts(rows)

        self.assertEqual(len(rows), EXPECTED_TOTAL)
        self.assertEqual(
            counts,
            {
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
            },
        )
        self.assertEqual(len({row.official_id for row in rows}), EXPECTED_TOTAL)
        self.assertEqual(len({row.name for row in rows}), EXPECTED_TOTAL)
        self.assertTrue(all(row.name and row.official_id for row in rows))
        self.assertTrue(all("기획분과" not in row.team_name for row in rows))

    def test_hash_mismatch_is_rejected(self) -> None:
        module = load_module()
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            module.parse_roster(SOURCE_PATH, "0" * 64)

    def test_seed_is_atomic_and_joins_returned_members(self) -> None:
        module = load_module()
        rows = module.parse_roster(SOURCE_PATH, EXPECTED_HASH)
        sql = module.build_seed_sql(rows, "0829-deliberation", EXPECTED_HASH)

        self.assertTrue(sql.startswith("begin;"))
        self.assertTrue(sql.rstrip().endswith("commit;"))
        self.assertIn("join upserted_members m on m.official_id = r.official_id", sql)
        self.assertIn(f"roster_count <> {EXPECTED_TOTAL}", sql)
        self.assertIn("1분과 1조", sql)
        # 개정 명단에서 빠진 사람의 배정을 내리지 않으면 hq_teams 인원·정족수가 부풀어 오른다.
        self.assertIn("update climate_vote.team_assignment ta", sql)
        self.assertIn("set active = false", sql)

    def test_dropped_members_are_gone(self) -> None:
        """2.0에서 빠진 드롭 3인이 남아 있으면 정족수가 틀어진다."""
        module = load_module()
        rows = module.parse_roster(SOURCE_PATH, EXPECTED_HASH)
        names = {row.name for row in rows}
        for dropped in ("김대준", "조웅철", "송병곤"):
            self.assertNotIn(dropped, names)

    def test_planning_teams_are_excluded(self) -> None:
        """기획분과 A·B조는 DB에 조가 없으므로 파서가 걸러야 한다."""
        module = load_module()
        rows = module.parse_roster(SOURCE_PATH, EXPECTED_HASH)
        self.assertTrue(all("기획" not in row.team_name for row in rows))


if __name__ == "__main__":
    unittest.main()
