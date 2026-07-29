import unittest

from fabric_metadata import extract_size_bytes, normalize_role_assignments


class ExtractSizeBytesTests(unittest.TestCase):
    def test_prefers_native_byte_fields(self):
        self.assertEqual(extract_size_bytes({"sizeInBytes": "2048", "sizeInMB": 9}), 2048)

    def test_converts_megabytes(self):
        self.assertEqual(extract_size_bytes({"sizeInMB": 1.5}), 1_572_864)

    def test_rejects_invalid_sizes(self):
        self.assertIsNone(extract_size_bytes({"sizeBytes": -1, "sizeInMB": "unknown"}))


class NormalizeRoleAssignmentsTests(unittest.TestCase):
    def test_normalizes_workspace_and_group_access_rights(self):
        rows = normalize_role_assignments("Workspace", "ws-1", [{
            "graphId": "ABC",
            "displayName": "Finance Readers",
            "principalType": "Group",
            "groupUserAccessRight": "Viewer",
        }])

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["scopeCanonicalId"], "fabric:workspace:ws-1")
        self.assertEqual(rows[0]["principalId"], "ABC")
        self.assertEqual(rows[0]["role"], "Viewer")

    def test_deduplicates_equivalent_assignments(self):
        user = {"identifier": "USER@EXAMPLE.COM", "reportUserAccessRight": "Read"}
        rows = normalize_role_assignments("Item", "item-1", [user, dict(user)])
        self.assertEqual(len(rows), 1)

    def test_ignores_rows_without_a_principal_or_role(self):
        self.assertEqual(normalize_role_assignments("Item", "item-1", [{"identifier": "x"}, {}]), [])


if __name__ == "__main__":
    unittest.main()