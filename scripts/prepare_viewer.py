#!/usr/bin/env python3
"""Validate the public lineage source and write ignored viewer assets."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "source/lineage.json"
ROOT_FIELDS = {"schema_version", "classes", "members", "edges"}
MEMBER_FIELDS = {"id", "name", "class", "roles", "layout_x"}
EDGE_FIELDS = {"source", "target"}
ALLOWED_ROLES = {"president", "sensei", "evan_chen_award"}


def build_graph(raw: object) -> dict:
    """Validate the contributor-facing schema and return viewer-safe data."""
    if not isinstance(raw, dict) or set(raw) != ROOT_FIELDS:
        raise ValueError("Source must contain only schema_version, classes, members, and edges.")
    if type(raw["schema_version"]) is not int or raw["schema_version"] != 2:
        raise ValueError("Unsupported lineage source schema_version.")
    classes = raw["classes"]
    members = raw["members"]
    edges = raw["edges"]
    if not isinstance(classes, list) or not classes or any(not isinstance(c, str) or not c.strip() for c in classes):
        raise ValueError("classes must be a non-empty ordered list of names.")
    if len(set(classes)) != len(classes):
        raise ValueError("Class names must be unique.")
    if not isinstance(members, list) or not members:
        raise ValueError("members must be a non-empty list.")
    if not isinstance(edges, list):
        raise ValueError("edges must be a list.")

    class_rank = {class_name: rank for rank, class_name in enumerate(classes)}
    ids: set[str] = set()
    viewer_nodes = []
    for member in members:
        if not isinstance(member, dict) or set(member) != MEMBER_FIELDS:
            raise ValueError("Each member must contain only id, name, class, roles, and layout_x.")
        member_id = member["id"]
        try:
            parsed_id = UUID(member_id)
        except (ValueError, TypeError, AttributeError) as error:
            raise ValueError("Member IDs must be stable UUIDs.") from error
        if str(parsed_id) != member_id or parsed_id.version != 4:
            raise ValueError("Member IDs must be canonical lowercase UUIDv4 values.")
        if member_id in ids:
            raise ValueError("Member IDs must be unique.")
        ids.add(member_id)
        name = member["name"]
        class_name = member["class"]
        roles = member["roles"]
        layout_x = member["layout_x"]
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Every member needs a display name.")
        if not isinstance(class_name, str) or class_name not in class_rank:
            raise ValueError(f"Unknown class for member {name!r}.")
        if (not isinstance(roles, list) or any(not isinstance(role, str) or role not in ALLOWED_ROLES for role in roles)
                or len(set(roles)) != len(roles)):
            raise ValueError(f"Roles for {name!r} must be unique values from president/sensei/evan_chen_award.")
        if isinstance(layout_x, bool) or not isinstance(layout_x, (int, float)) or not math.isfinite(layout_x):
            raise ValueError(f"layout_x for {name!r} must be a finite number.")
        viewer_nodes.append({
            "id": len(viewer_nodes) + 1,
            "display_name": name.strip(),
            "class_name": class_name.strip(),
            "rank": class_rank[class_name],
            "x": layout_x,
            "roles": list(roles),
        })

    rank_by_id = {member["id"]: class_rank[member["class"]] for member in members}
    viewer_id_by_source_id = {member["id"]: index + 1 for index, member in enumerate(members)}
    seen_edges: set[tuple[str, str]] = set()
    viewer_edges = []
    for edge in edges:
        if not isinstance(edge, dict) or set(edge) != EDGE_FIELDS:
            raise ValueError("Each edge must contain only source and target member IDs.")
        source, target = edge["source"], edge["target"]
        if not isinstance(source, str) or not isinstance(target, str):
            raise ValueError("Relationship endpoints must be member IDs.")
        if source not in ids or target not in ids:
            raise ValueError("Relationship references an unknown member ID.")
        if source == target:
            raise ValueError("A member cannot be their own Big Bro.")
        if rank_by_id[source] >= rank_by_id[target]:
            raise ValueError("Relationships must point from an earlier to a later class.")
        pair = (source, target)
        if pair in seen_edges:
            raise ValueError("Duplicate Big–Little relationships are not allowed.")
        seen_edges.add(pair)
        viewer_edges.append({"source": viewer_id_by_source_id[source], "target": viewer_id_by_source_id[target]})
    return {"nodes": viewer_nodes, "edges": viewer_edges}


def prepare(source: Path = DEFAULT_SOURCE) -> dict:
    raw = json.loads(Path(source).read_text(encoding="utf-8"))
    graph = build_graph(raw)
    target = ROOT / "public/data"
    target.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(graph, ensure_ascii=True, separators=(",", ":"))
    (target / "graph.json").write_text(payload + "\n", encoding="utf-8")
    (target / "graph.js").write_text("globalThis.LINEAGE_DATA = " + payload + ";\n", encoding="utf-8")
    # The editor needs the contributor-facing UUID schema, not runtime numeric IDs.
    # Validation above guarantees this is the sanitized allowlisted public source.
    source_payload = json.dumps(raw, ensure_ascii=True, separators=(",", ":"))
    (target / "source.js").write_text("globalThis.LINEAGE_SOURCE = " + source_payload + ";\n", encoding="utf-8")
    print(f"Prepared local viewer: {len(graph['nodes'])} members, {len(graph['edges'])} relationships.")
    return graph


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--graph-path", type=Path, default=DEFAULT_SOURCE)
    prepare(parser.parse_args().graph_path)
