import re
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
VIEW_SOURCE = (ROOT / "create_semantic_views.py").read_text(encoding="utf-8")
ITEM_TMDL = (ROOT / "semantic_model" / "definition" / "tables" / "Item.tmdl").read_text(encoding="utf-8")
RELATIONSHIPS_TMDL = (ROOT / "semantic_model" / "definition" / "relationships.tmdl").read_text(encoding="utf-8")


class SemanticContractTests(unittest.TestCase):
    def test_item_timestamps_are_typed_end_to_end(self):
        for source, alias in (
            ("i.createdDate", "CreatedDate"),
            ("i.modifiedDate", "ModifiedDate"),
            ("i.lastRefresh", "LastRefresh"),
        ):
            self.assertRegex(
                VIEW_SOURCE,
                rf"TRY_CONVERT\(datetime2\(3\), {re.escape(source)}\)\s+AS {alias}",
            )
        for column in ("Created Date", "Modified Date", "Last Refresh"):
            self.assertRegex(ITEM_TMDL, rf"column '{column}'\s+dataType: dateTime")

    def test_item_numeric_metrics_use_explicit_measures(self):
        for measure in ("Total Size (Bytes)", "# Tables", "# Columns"):
            self.assertIn(f"measure '{measure}'", ITEM_TMDL)
        for column in ("Size Bytes", "Table Count", "Column Count"):
            self.assertRegex(ITEM_TMDL, rf"column '{column}'\s+dataType: int64\s+isHidden")

    def test_item_tags_reach_the_semantic_model(self):
        self.assertRegex(VIEW_SOURCE, r"i\.tags\s+AS Tags")
        self.assertRegex(ITEM_TMDL, r"column Tags\s+dataType: string\s+summarizeBy: none\s+sourceColumn: Tags")

    def test_every_visible_tmdl_object_has_a_description(self):
        tables = ROOT / "semantic_model" / "definition" / "tables"
        for path in tables.glob("*.tmdl"):
            lines = path.read_text(encoding="utf-8").splitlines()
            object_indexes = [
                index
                for index, line in enumerate(lines)
                if line.startswith("table ") or line.startswith("\tmeasure ") or line.startswith("\tcolumn ")
            ]
            for position, index in enumerate(object_indexes):
                line = lines[index]
                next_index = object_indexes[position + 1] if position + 1 < len(object_indexes) else len(lines)
                block = lines[index:next_index]
                if line.startswith("\tcolumn ") and any(entry.strip() == "isHidden" for entry in block):
                    continue
                previous = next((entry.strip() for entry in reversed(lines[:index]) if entry.strip()), "")
                self.assertTrue(
                    previous.startswith("/// "),
                    f"{path.name}: {line.strip()} is visible but has no description",
                )

    def test_relationships_have_no_unused_inactive_paths(self):
        self.assertNotIn("isActive: false", RELATIONSHIPS_TMDL)

    def test_mixed_unit_measures_require_one_metric(self):
        tables = ROOT / "semantic_model" / "definition" / "tables"
        for filename in ("Coverage.tmdl", "Posture.tmdl", "Metric History.tmdl"):
            self.assertIn("HASONEVALUE", (tables / filename).read_text(encoding="utf-8"))

    def test_hidden_columns_are_not_exposed_through_mdx(self):
        tables = ROOT / "semantic_model" / "definition" / "tables"
        for path in tables.glob("*.tmdl"):
            blocks = re.split(r"(?=\n\tcolumn )", path.read_text(encoding="utf-8"))
            for block in blocks:
                if "\n\t\tisHidden\n" in block:
                    self.assertIn(
                        "\n\t\tisAvailableInMdx: false\n",
                        block,
                        f"{path.name}: hidden column remains available through MDX",
                    )


if __name__ == "__main__":
    unittest.main()