from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT_PATH = Path(__file__).with_name("import-attendance-roster.py")
SOURCE_PATH = Path(r"C:\Users\iceam\Downloads\20260704 시민참여단 참석명단.hwpx")
EXPECTED_HASH = "7D486447CA6873C94F99E401A87E939E164EC3C15126E91E1E6F2D67958E7BD3"


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

        self.assertEqual(len(rows), 174)
        self.assertEqual(
            counts,
            {
                "1분과 1조": 12,
                "1분과 2조": 12,
                "1분과 3조": 12,
                "1분과 4조": 12,
                "1분과 5조": 12,
                "2분과 1조": 9,
                "2분과 2조": 12,
                "2분과 3조": 12,
                "2분과 4조": 12,
                "2분과 5조": 12,
                "3분과 1조": 9,
                "3분과 2조": 12,
                "3분과 3조": 12,
                "3분과 4조": 12,
                "3분과 5조": 12,
            },
        )
        self.assertEqual(len({row.official_id for row in rows}), 174)
        self.assertEqual(len({row.name for row in rows}), 174)
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
        self.assertIn("roster_count <> 174", sql)
        self.assertIn("1분과 1조", sql)


if __name__ == "__main__":
    unittest.main()
