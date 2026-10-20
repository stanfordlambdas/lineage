import copy
import unittest

from scripts.prepare_viewer import build_graph


FIRST = "7a71d737-cfb8-4225-bdf9-b9a98e790ef1"
SECOND = "77319fa7-16cc-4a8d-b97c-1fe58f0434e5"


def sample_source():
    return {
        "schema_version": 2,
        "classes": ["Founding", "Alpha"],
        "members": [
            {"id": FIRST, "name": "Big Brother", "class": "Founding", "roles": ["president"], "layout_x": 1.0},
            {"id": SECOND, "name": "Little Brother", "class": "Alpha", "roles": ["sensei"], "layout_x": 2.0},
        ],
        "edges": [{"source": FIRST, "target": SECOND}],
    }


class LineageSourceTests(unittest.TestCase):
    def test_rejects_private_or_unknown_fields(self):
        for field in ("roster_number", "email", "phone", "location", "company"):
            source = sample_source()
            source["members"][0][field] = "must not be published"
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "only id, name, class, roles, and layout_x"):
                build_graph(source)

    def test_rejects_bad_ids_edges_roles_and_class_order(self):
        mutations = [
            (lambda s: s["members"].append(copy.deepcopy(s["members"][0])), "unique"),
            (lambda s: s["edges"].append({"source": FIRST, "target": "00000000-0000-4000-8000-000000000000"}), "unknown member"),
            (lambda s: s["edges"].append({"source": FIRST, "target": SECOND}), "Duplicate"),
            (lambda s: s["edges"].__setitem__(0, {"source": SECOND, "target": FIRST}), "earlier to a later class"),
            (lambda s: s["edges"].__setitem__(0, {"source": FIRST, "target": FIRST}), "own Big Bro"),
            (lambda s: s["members"][0].__setitem__("roles", ["administrator"]), "president/sensei"),
            (lambda s: s["members"][0].__setitem__("id", "not-a-uuid"), "UUIDs"),
        ]
        for mutate, message in mutations:
            source = sample_source()
            mutate(source)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                build_graph(source)

    def test_allows_multiple_big_bros_and_rejects_duplicate_classes(self):
        source = sample_source()
        source["members"].append({"id": "ecedce32-43a9-451d-a629-4c6c7cf719be", "name": "Second Big", "class": "Founding", "roles": [], "layout_x": 3.0})
        source["edges"].append({"source": "ecedce32-43a9-451d-a629-4c6c7cf719be", "target": SECOND})
        self.assertEqual(len(build_graph(source)["edges"]), 2)
        source["classes"].append("Founding")
        with self.assertRaisesRegex(ValueError, "unique"):
            build_graph(source)


if __name__ == "__main__":
    unittest.main()
