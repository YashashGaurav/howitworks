// Graph analysis: reach, ranking, packages, import cycles.
import { ext, base, dirname, PY_EXT, JVM_EXT } from "./scan.mjs";

/** Iterative Tarjan. adj: Map<node, Iterable<node>>. Returns array of components (arrays). */
export function scc(nodes, adj) {
  let idx = 0; const index = new Map(), low = new Map(), on = new Set(), stack = [], out = [];
  for (const start of nodes) {
    if (index.has(start)) continue;
    const work = [[start, adj.get(start)[Symbol.iterator]()]];
    index.set(start, idx); low.set(start, idx); idx++; stack.push(start); on.add(start);
    while (work.length) {
      const [v, it] = work[work.length - 1];
      const nx = it.next();
      if (!nx.done) {
        const w = nx.value;
        if (!adj.has(w)) continue;
        if (!index.has(w)) { index.set(w, idx); low.set(w, idx); idx++; stack.push(w); on.add(w); work.push([w, adj.get(w)[Symbol.iterator]()]); }
        else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
        if (low.get(v) === index.get(v)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v); out.push(comp); }
      }
    }
  }
  return out;
}

function reach(start, adj) {
  const seen = new Set([start]), st = [start];
  while (st.length) { const v = st.pop(); for (const w of adj.get(v) || []) if (!seen.has(w)) { seen.add(w); st.push(w); } }
  seen.delete(start); return seen;
}

function cycleCuts(out, comp, steps = 3) {
  const members = new Set(comp);
  const M = new Map(comp.map(v => [v, new Set([...out.get(v)].filter(w => members.has(w)))]));
  const cuts = [];
  for (let s = 0; s < steps; s++) {
    const comps = scc([...M.keys()], M).filter(c => c.length > 1);
    if (!comps.length) break;
    const big = comps.reduce((a, b) => (b.length > a.length ? b : a));
    const bs = new Set(big);
    const S = new Map(big.map(v => [v, new Set([...M.get(v)].filter(w => bs.has(w)))]));
    let edges = []; for (const [a, ws] of S) for (const b of ws) edges.push([a, b]);
    if (edges.length > 300) {
      const indeg = new Map(big.map(v => [v, 0])); for (const [, b] of edges) indeg.set(b, indeg.get(b) + 1);
      edges.sort((x, y) => (S.get(y[0]).size * indeg.get(y[1])) - (S.get(x[0]).size * indeg.get(x[1])));
      edges = edges.slice(0, 300);
    }
    let best = null, bestSize = big.length;
    for (const [a, b] of edges) {
      S.get(a).delete(b);
      const size = Math.max(...scc(big, S).map(c => c.length));
      S.get(a).add(b);
      if (size < bestSize) { best = [a, b]; bestSize = size; }
    }
    if (!best) break;
    M.get(best[0]).delete(best[1]);
    const rest = scc([...M.keys()], M).filter(c => c.length > 1);
    cuts.push({ from: best[0], to: best[1], after: rest.length ? Math.max(...rest.map(c => c.length)) : 0 });
  }
  return cuts;
}

const NOISE = new Set(["src", "lib", "app", "source", "sources", "include", "inc"]);
function logicalGroups(nodes, py, jvm, maxGroups = 40) {
  const segs = new Map();
  for (const f of nodes) {
    const x = ext(f);
    if (JVM_EXT.has(x) && jvm.pkgOf.get(f)) segs.set(f, jvm.pkgOf.get(f).split("."));
    else if (PY_EXT.has(x) && py.moduleOf.get(f)) {
      const mod = py.moduleOf.get(f), pkg = f.endsWith("__init__.py") ? mod : mod.slice(0, Math.max(0, mod.lastIndexOf(".")));
      segs.set(f, pkg ? pkg.split(".") : ["(root)"]);
    } else {
      const d = dirname(f).split("/").filter(s => s && !NOISE.has(s));
      segs.set(f, d.length ? d : ["(root)"]);
    }
  }
  const vals = [...segs.values()];
  let common = 0;
  while (vals.length && vals.every(s => s.length > common + 1) && new Set(vals.map(s => s[common])).size === 1) common++;
  const key = new Map([...segs].map(([f, s]) => [f, s.slice(common)]));
  for (;;) {
    const sizes = new Map();
    for (const k of key.values()) { const j = k.join("/"); sizes.set(j, (sizes.get(j) || 0) + 1); }
    if (sizes.size <= maxGroups) break;
    const cands = [...sizes.keys()].filter(k => k.includes("/"));
    if (!cands.length) break;
    cands.sort((a, b) => sizes.get(a) - sizes.get(b) || b.split("/").length - a.split("/").length);
    const victim = cands[0];
    for (const [f, k] of key) if (k.join("/") === victim) key.set(f, k.slice(0, -1));
  }
  return new Map([...key].map(([f, k]) => [f, k.join("/")]));
}

export function analyze(g) {
  const { out } = g;
  const inA = new Map([...out.keys()].map(f => [f, new Set()]));
  for (const [a, ws] of out) for (const b of ws) inA.get(b).add(a);
  const nodes = [...out.keys()].filter(f => out.get(f).size || inA.get(f).size);
  const isolated = out.size - nodes.length;
  const n = nodes.length;
  if (!n) throw new Error("No imports between source files were found. Supported languages: Python, Java, Kotlin, Scala, TypeScript, JavaScript, C, C++.");
  const ancestors = new Map(nodes.map(v => [v, reach(v, inA)]));
  const maxFanIn = Math.max(1, ...nodes.map(v => inA.get(v).size));
  const rows = nodes.map(v => ({
    id: v, fan_in: inA.get(v).size, fan_out: out.get(v).size, blast: ancestors.get(v).size,
    score: 0.6 * ancestors.get(v).size / Math.max(n - 1, 1) + 0.4 * inA.get(v).size / maxFanIn,
  })).sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => (r.rank = i + 1));
  const groups = logicalGroups(nodes, g.py, g.jvm);
  rows.forEach(r => (r.group = groups.get(r.id)));
  const gedges = new Map();
  for (const a of nodes) for (const b of out.get(a)) {
    const ga = groups.get(a), gb = groups.get(b);
    if (ga && gb && ga !== gb) { const k = ga + "\u0000" + gb; gedges.set(k, (gedges.get(k) || 0) + 1); }
  }
  const byId = new Map(rows.map(r => [r.id, r]));
  const sccs = scc(nodes, out).filter(c => c.length > 1).sort((a, b) => b.length - a.length);
  const cycles = sccs.slice(0, 10).map(c => ({ files: c.sort((a, b) => byId.get(a).rank - byId.get(b).rank), cuts: cycleCuts(out, c) }));
  return {
    nodes: rows, byId, ancestors, inA, out, isolated,
    groupEdges: [...gedges].map(([k, w]) => { const [a, b] = k.split("\u0000"); return [a, b, w]; }),
    cycles, edgeCount: nodes.reduce((s, v) => s + out.get(v).size, 0),
  };
}
