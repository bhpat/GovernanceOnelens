import base64
import importlib
import os
import sys
import unittest
from unittest.mock import patch


class SemanticModelConfigTests(unittest.TestCase):
    def test_build_parts_renders_sql_parameters_without_leaking_placeholders(self):
        environment = {
            "ONELENS_ANALYSIS_WORKSPACE_ID": "11111111-1111-1111-1111-111111111111",
            "ONELENS_SQL_SERVER": 'example"server.database.fabric.microsoft.com,1433',
            "ONELENS_SQL_DB": "governance-test",
        }
        with patch.dict(os.environ, environment, clear=True):
            sys.modules.pop("create_semantic_model", None)
            module = importlib.import_module("create_semantic_model")
            part = next(item for item in module.build_parts() if item["path"] == "definition/expressions.tmdl")

        rendered = base64.b64decode(part["payload"]).decode("utf-8")
        self.assertIn('example""server.database.fabric.microsoft.com,1433', rendered)
        self.assertIn("governance-test", rendered)
        self.assertNotIn("__ONELENS_", rendered)


if __name__ == "__main__":
    unittest.main()