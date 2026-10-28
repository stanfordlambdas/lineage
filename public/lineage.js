/* Pure graph operations, shared by the viewer and local verification. */
(function (root) {
  'use strict';
  const CARD_W = 220, CARD_H = 72, ROW = 144, GAP = 260;

  function normalize(raw) {
    if (!raw || !Array.isArray(raw.nodes) || !raw.nodes.length || !Array.isArray(raw.edges)) throw Error('Choose a graph JSON containing nodes and edges.');
    // An allowlist deliberately drops all directory/contact fields on file import.
    const sourceIds = raw.nodes.map(n => Number('Roster_Number' in n ? n.Roster_Number : n.id));
    const idMap = new Map(sourceIds.map((id, index) => [id, index + 1]));
    if (idMap.size !== raw.nodes.length || sourceIds.some(id => !Number.isInteger(id))) throw Error('The graph contains duplicate or invalid IDs.');
    const nodes = raw.nodes.map((n, index) => {
      const source = 'Roster_Number' in n;
      const rawRoles = source
        ? [n.Is_President && 'president', n.Is_Sensei && 'sensei'].filter(Boolean)
        : (Array.isArray(n.roles) ? n.roles : []);
      return {
        id: index + 1,
        // ?? '' keeps a missing value empty so it fails the check below instead of becoming "undefined".
        display_name: String((source ? n.Display_Name : (n.display_name || n.name)) ?? '').trim(),
        class_name: String((source ? n.Class : n.class_name) ?? '').trim(),
        rank: Number(source ? n.Class_Order - 1 : n.rank),
        x: Number(source ? n.Layout_X : n.x),
        roles: [...new Set(rawRoles.filter(role => role === 'president' || role === 'sensei' || role === 'evan_chen_award'))],
      };
    });
    const byId = new Map(nodes.map(n => [n.id, n]));
    if (nodes.some(n => !n.display_name || !n.class_name || !Number.isInteger(n.rank) || n.rank < 0 || !Number.isFinite(n.x))) throw Error('The graph contains a missing name or class, or invalid coordinates.');
    const unique = new Map();
    for (const e of raw.edges) {
      const a = idMap.get(Number(e.source)), b = idMap.get(Number(e.target));
      if (!byId.has(a) || !byId.has(b) || byId.get(a).rank >= byId.get(b).rank) throw Error('A relationship has a missing member or runs backwards through pledge classes.');
      unique.set(`${a}:${b}`, {source: a, target: b});
    }
    return {nodes, edges: [...unique.values()]};
  }

  function model(graph) {
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    const parents = new Map(graph.nodes.map(n => [n.id, []]));
    const children = new Map(graph.nodes.map(n => [n.id, []]));
    graph.edges.forEach(e => { parents.get(e.target).push(e.source); children.get(e.source).push(e.target); });
    function walk(id, direction) {
      const seen = new Set(), queue = [...direction.get(id)];
      while (queue.length) {
        const next = queue.pop();
        if (seen.has(next) || next === id) continue;
        seen.add(next); queue.push(...direction.get(next));
      }
      return seen;
    }
    function family(id) {
      const ancestors = walk(id, parents), descendants = walk(id, children);
      return {ancestors, descendants, all: new Set([id, ...ancestors, ...descendants])};
    }
    return {byId, parents, children, family};
  }

  function layout(nodes) {
    const rows = new Map();
    nodes.forEach(n => { if (!rows.has(n.rank)) rows.set(n.rank, []); rows.get(n.rank).push(n); });
    const points = new Map(), unit = 195;
    for (const [rank, row] of rows) {
      row.sort((a, b) => a.x - b.x || a.id - b.id);
      let previous = -Infinity;
      row.forEach(n => {
        // Keep the same horizontal family corridors in isolated mode. Only
        // resolve collisions within a class; re-centering each row independently
        // can send a multi-generation edge through an unrelated member card.
        let x = 200 + n.x * unit;
        x = Math.max(x, previous + GAP); previous = x;
        points.set(n.id, {x, y: 90 + n.rank * ROW});
      });
    }
    return points;
  }
  function bounds(ids, points) {
    const ps = [...ids].map(id => points.get(id)).filter(Boolean);
    if (!ps.length) return null;
    const x = Math.min(...ps.map(p => p.x)) - CARD_W / 2 - 40;
    const y = Math.min(...ps.map(p => p.y)) - CARD_H / 2 - 45;
    return {x, y, w: Math.max(...ps.map(p => p.x)) + CARD_W / 2 + 40 - x, h: Math.max(...ps.map(p => p.y)) + CARD_H / 2 + 45 - y};
  }
  const api = {normalize, model, layout, bounds, CARD_W, CARD_H, ROW};
  if (typeof module !== 'undefined') module.exports = api;
  root.Lineage = api;
})(globalThis);
