import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from onelens_config import configured, required, required_uuid


class OneLensConfigTests(unittest.TestCase):
    def test_reads_deployed_runtime_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(json.dumps({"ONELENS_SQL_DB": "catalog"}), encoding="utf-8")
            with patch.dict(os.environ, {"ONELENS_RUNTIME_CONFIG_FILE": str(path)}, clear=True):
                self.assertEqual(required("ONELENS_SQL_DB"), "catalog")

    def test_environment_overrides_runtime_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(json.dumps({"ONELENS_SQL_DB": "from-file"}), encoding="utf-8")
            with patch.dict(os.environ, {
                "ONELENS_RUNTIME_CONFIG_FILE": str(path),
                "ONELENS_SQL_DB": "from-environment",
            }, clear=True):
                self.assertEqual(configured("ONELENS_SQL_DB"), "from-environment")

    def test_validates_uuid_from_runtime_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(json.dumps({"ONELENS_WORKSPACE_ID": "not-a-uuid"}), encoding="utf-8")
            with patch.dict(os.environ, {"ONELENS_RUNTIME_CONFIG_FILE": str(path)}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "must be a UUID"):
                    required_uuid("ONELENS_WORKSPACE_ID")


if __name__ == "__main__":
    unittest.main()