// What the code says about itself: README, doc comments, entry points,
// HTTP routes, dependencies, modules. Produces the "repo map" that the
// architecture description is written from.
import fs from "node:fs";
import path from "node:path";
import { discover, read, countLines, ext, base, dirname, languageOf, PY_EXT, JVM_EXT, JS_EXT, CPP_EXT, CPP_SOURCE_EXT, KT_TOPLEVEL_RE, SKIP_DIRS, blankPyStrings } from "./scan.mjs";

const SUPPORT_PATH_RE = /(^|[/-])(test|tests|testing|testapp|test-app|testing-support|sample|samples|example|examples|demo|build-logic|buildSrc|benchmarks?|bench|scripts?|tools|mockwebserver[\w-]*|[\w-]*-deprecated)([/-]|$)/i;
/** Test, sample and build code. Only folders above the source root count, so a
 *  Java package like org/springframework/samples/petclinic is product code. */
export const SUPPORT_RE = { test(p) { const m = p.match(/^(.*?)(?:^|\/)src\//); return SUPPORT_PATH_RE.test(m ? m[1] : dirname(p)); } };

export function cleanDoc(raw) {
  raw = raw.replace(/^[^\n]*\n\s*[=~^\-]{3,}\s*$/gm, "").replace(/:\w+:`~?(?:[\w.]*\.)?(\w+)`/g, "$1");
  const lines = [];
  for (let line of raw.split("\n")) {
    line = line.replace(/^\s*(\/\*\*?|\*\/|\*|\/\/+|#)\s?/, "").trimEnd();
    if (/^\s*@(param|return|throws|see|since|author|deprecated|suppress|sample|property|constructor)\b/.test(line)) break;
    lines.push(line);
  }
  let t = lines.map(l => l.trim()).filter(Boolean).join(" ");
  t = t.replace(/\{@(?:link|code|linkplain)\s+([^}\s]+)[^}]*\}/g, "$1").replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
       .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\](?!\()/g, "$1").replace(/<[^>]+>/g, "").replace(/`/g, "")
       .replace(/\s+/g, " ").trim().replace(/ — /g, ": ").replace(/—/g, ", ");
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  let s = m ? m[1] : t;
  if (s.length > 180) s = s.slice(0, 177).replace(/\s\S*$/, "") + "...";
  if (/^(Copyright|Licensed|SPDX|This Source Code|Generated|Auto-generated|@|https?:\/\/|www\.|Use of this source code|All rights reserved|Distributed under|This file is part of|This program is free software|Permission is hereby granted|THIS SOFTWARE IS PROVIDED|Redistribution and use|-\*-)/i.test(s) || s.length < 12) return "";
  return s;
}

export function readmeBlurb(file, projectName = "") {
  let t; try { t = fs.readFileSync(file, "utf8"); } catch { return ""; }
  t = t.replace(/<!--[\s\S]*?-->/g, "").replace(/```[\s\S]*?```/g, "").replace(/^[^\n]*\n[=\-]{3,}[ \t]*$/gm, "");
  const ok = [];
  for (let p of t.split(/\n\s*\n/)) {
    if (/^( {4}|\t)/.test(p)) continue; // indented code
    p = p.trim();
    if (!p || /^(#|!|\[!|\[!\[|<|\||---|===|>|[-*+]\s|\d+\.\s)/.test(p)) continue;
    p = p.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
    if (p.length < 30 || /^(See|Check|Please|Note|For more|For details|To |Read|Visit|Learn more|Documentation|Docs|Try|Join|Follow|Star)\b/i.test(p)) continue;
    if (/^This (document|README|readme|guide|file|page|repository|repo)\b/.test(p) || /^[\w&+ ]{1,20}:\s/.test(p) && /stack\s*overflow|discord|slack|gitter|mailing list|issues/i.test(p)) continue;
    if ((p.match(/https?:\/\//g) || []).length > 2) continue;
    ok.push(p);
    if (ok.length >= 12) break;
  }
  // Prefer the paragraph that names the project and says what it is.
  const nm = String(projectName).toLowerCase().replace(/[^a-z0-9]/g, "");
  const names = x => nm.length >= 2 && x.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).some(w => w === nm || (nm.length > 4 && w.includes(nm)));
  const defines = x => /\b(is|are)\s+(a|an|the)\b/i.test(x.slice(0, 200));
  const early = ok.slice(0, 3);
  let p = early.find(x => names(x) && defines(x)) || early.find(x => names(x)) || early.find(defines) || ok[0] || "";
  p = p.replace(/ — /g, ": ").replace(/—/g, ", ");
  return p.length > 420 ? p.slice(0, 417).replace(/\s\S*$/, "") + "..." : p;
}

const ROUTES = [
  /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]+)"/g,
  /@\w+\.(route|get|post|put|delete|patch|websocket)\(\s*["']([^"']+)["']/g,
  /\b(?:app|router|server|api)\.(get|post|put|delete|patch|all|use)\(\s*["'`](\/[^"'`]*)["'`]/g,
  /\b(path|re_path)\(\s*r?["']([^"']*)["']\s*,/g,
  /\bCROW_ROUTE\(\s*\w+\s*,\s*"([^"]+)"\s*\)()/g,
];

function stripComments(text, x) {
  if (PY_EXT.has(x)) return blankPyStrings(text).replace(/^\s*#.*$/gm, "");
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'])\/\/[^\n]*/gm, "$1");
}

function entryKind(rel, code, raw) {
  if (/@SpringBootApplication|@QuarkusMain|@MicronautApplication/.test(code)) return "application";
  if (/^\s*(?:public\s+)?static\s+void\s+main\s*\(|^fun\s+main\s*\(|^\s*def\s+main\s*\(\s*args\s*:\s*Array\[String\]/m.test(code)) return "main";
  if (CPP_EXT.has(ext(rel)) && /^\s*(?:extern\s+"C"\s+)?(?:int|auto|void)\s+w?main\s*\(/m.test(code)) return "main";
  if (base(rel) === "__main__.py" || /if\s+__name__\s*==\s*['"]__main__['"]/.test(raw)) return "main";
  if (raw.startsWith("#!") && raw.split("\n")[0].includes("node")) return "cli";
  if (/@(RestController|Controller)\b/.test(code)) return "http";
  if (new RegExp(ROUTES[1].source).test(code) || new RegExp(ROUTES[2].source).test(code)) return "http";
  if (/\b(click\.(command|group)|typer\.Typer|argparse\.ArgumentParser)\b/.test(code)) return "cli";
  return null;
}

function routesOf(code) {
  const out = [];
  const pm = code.match(/@RequestMapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]+)"\s*\}?\s*\)\s*(?:@\w+\s*)*(?:public\s+)?(?:class|interface)/);
  const prefix = pm ? pm[1].replace(/\/$/, "") : "";
  ROUTES.forEach((rx, i) => {
    for (const m of code.matchAll(new RegExp(rx.source, "g"))) {
      let verb = m[1].toUpperCase(), p = m[2];
      if (i === 0) {
        if (verb === "REQUEST" && prefix && p.replace(/\/$/, "") === prefix) continue;
        if (verb === "REQUEST") verb = "ANY";
        if (prefix) p = prefix + (p.startsWith("/") ? "" : "/") + p;
      } else if (i === 1 && verb === "ROUTE") {
        verb = "ANY";
        const mt = code.slice(m.index + m[0].length, m.index + m[0].length + 120).match(/methods\s*=\s*\[([^\]]+)\]/);
        if (mt) verb = mt[1].split(",").map(s => s.trim().replace(/['"]/g, "")).join(",");
      } else if (i === 3) { verb = "ANY"; p = "/" + p.replace(/^\^/, "").replace(/\$$/, ""); }
      else if (i === 4) { verb = "ANY"; p = m[1]; }
      else if (verb === "USE" || verb === "ALL") verb = "ANY";
      const r = `${verb} ${p}`; if (!out.includes(r)) out.push(r);
    }
  });
  return out.slice(0, 12);
}

const JVM_DECL_RE = /^(?:@[\w.]+(?:\([^)]*\))?\s*)*(?!private|internal)(?:(?:public|protected|abstract|final|open|sealed|data|enum|value|annotation|inline|fun|static|case)\s+)*(class|interface|object|enum|record|trait|@interface)\s+([A-Z]\w*)/gm;
const JVM_DOC_DECL_RE = /\/\*\*([\s\S]*?)\*\/\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:(?:public|protected|internal|private|abstract|final|open|sealed|data|enum|value|annotation|inline|fun|static|case)\s+)*(?:class|interface|object|enum|record|trait|@interface|typealias)\s+([A-Z]\w*)/g;
const TS_EXPORT_RE = /^export\s+(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(class|function\*?|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

const LICENSE_RE = /copyright|licen[sc]e|spdx|redistribution|all rights reserved|warranty|governed by|permission is hereby|free software|available under|\b(BSD|MIT|GPL|AGPL|LGPL|SSPL|Apache)\b.*\bterms\b/i;

/** C/C++ file description, from one of two places: the comment at the top of
 *  the file (before any #include or code), or the comment directly above the
 *  first class/struct. License text and comments elsewhere are never used. */
function commentParas(raw) {
  const lines = raw.split("\n").map(l => l.replace(/^\s*(\/\/+!?|\/?\*+!?)\s?/, "").replace(/\*\/\s*$/, ""));
  const paras = []; let cur = [];
  for (const l of lines) { if (l.trim()) cur.push(l); else if (cur.length) { paras.push(cur.join("\n")); cur = []; } }
  if (cur.length) paras.push(cur.join("\n"));
  return paras;
}
function firstDescription(blockText) {
  for (const para of commentParas(blockText)) {
    if (LICENSE_RE.test(para) || /^\s*(#|-\*-|vim?:|@file\s*$)/.test(para)) continue;
    const c = cleanDoc(para.replace(/^\s*@(file|brief)\b[^\n]*?\s/, "").replace(/(^|\s)[-=*~#]{3,}(?=\s|$)/g, " "));
    if (c && !/^[\w.]+\.(h|hpp|c|cc|cpp)$/.test(c)) return c;
  }
  return "";
}
function cppSummary(text, fileName) {
  const head = text.slice(0, 20000);
  // 1. Top of file: comments before the first include or code line.
  const lines = head.split("\n"); let i = 0, inBlock = false;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (inBlock) { if (l.includes("*/")) inBlock = false; continue; }
    if (!l || l.startsWith("//")) continue;
    if (l.startsWith("/*")) { if (!l.includes("*/")) inBlock = true; continue; }
    if (/^#\s*(ifndef|define|pragma\s+once|if\s+!\s*defined)/.test(l)) continue;
    break;
  }
  const top = lines.slice(0, i).join("\n");
  for (const m of top.matchAll(/\/\*([\s\S]*?)\*\/|((?:^[ \t]*\/\/[^\n]*\n?)+)/gm)) { const d = firstDescription(m[1] ?? m[2]); if (d) return d; }
  // 2. The comment directly above the first class/struct/union.
  // Only when that class is the file's subject (its name matches the file name).
  const stem = String(fileName || "").replace(/\.[^.]+$/, "").replace(/[_-]/g, "").toLowerCase();
  const decl = head.match(/((?:\/\*(?:(?!\*\/)[\s\S])*\*\/|(?:[ \t]*\/\/[^\n]*\n)+))\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|union)\s+(?:[A-Z_]+_EXPORT\s+)?(\w+)[^;{(]*\{/);
  if (decl) {
    const nm = decl[2].toLowerCase().replace(/_/g, "");
    if (stem && (nm.includes(stem) || stem.includes(nm))) { const d = firstDescription(decl[1].replace(/^\/\*|\*\/$/g, "")); if (d) return d; }
  }
  return "";
}

export function fileFacts(rel, text) {
  const x = ext(rel); let summary = "", symbols = [];
  if (PY_EXT.has(x)) {
    const doc = text.match(/^(?:\s|#[^\n]*\n)*[rRuUbB]{0,2}("""|''')([\s\S]*?)\1/);
    if (doc) summary = cleanDoc(doc[2]);
    const all = text.match(/^__all__\s*=\s*[\[(]([\s\S]*?)[\])]/m);
    const classes = [...text.matchAll(/^class\s+([A-Za-z]\w*)[^\n]*:\s*\n\s+[rRuU]?("""|''')([\s\S]*?)\2/gm)];
    symbols = [...text.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/gm)].map(m => m[1]);
    if (all) { const names = [...all[1].matchAll(/["'](\w+)["']/g)].map(m => m[1]); if (names.length) symbols = names; }
    if (!summary) {
      const stem = base(rel).replace(/\.py$/, "").replace(/_/g, "").toLowerCase();
      const nClasses = (text.match(/^class\s+[A-Za-z]/gm) || []).length;
      for (const c of classes) {
        const nm = c[1].toLowerCase();
        if (nClasses === 1 || nm.includes(stem) || stem.includes(nm)) { summary = cleanDoc(c[3]); if (summary) break; }
      }
    }
    if (!summary && !symbols.length && rel.endsWith("__init__.py")) {
      const srcs = [...new Set([...text.matchAll(/^from\s+\.+([\w.]+)\s+import/gm)].map(m => m[1]))];
      if (srcs.length) summary = `Package entry: re-exports from ${srcs.slice(0, 5).join(", ")}.`;
    }
  } else if (JVM_EXT.has(x)) {
    const stem = base(rel).replace(/\.[^.]+$/, "");
    const docs = [...text.matchAll(JVM_DOC_DECL_RE)];
    const best = docs.find(m => m[2] === stem) || docs[0];
    if (best) summary = cleanDoc(best[1]);
    symbols = [...text.matchAll(JVM_DECL_RE)].map(m => m[2]);
    if (!symbols.length && /\.kts?$/.test(x)) symbols = [...text.matchAll(KT_TOPLEVEL_RE)].filter(m => !/^\s*(private|internal)/.test(m[0])).map(m => m[1]).slice(0, 6);
  } else if (CPP_EXT.has(x)) {
    summary = cppSummary(text, base(rel));
    symbols = [...text.matchAll(/^[ \t]*(?:template\s*<[^>]*>\s*)?(?:class|struct)\s+(?:[A-Z_]+_EXPORT\s+|alignas\([^)]*\)\s*|\[\[[^\]]*\]\]\s*)*([A-Za-z_]\w*)\s*(?:final\s*)?(?::[^;{]*)?\{/gm)].map(m => m[1]);
    if (!symbols.length && /\.(c|h)$/.test(x)) symbols = [...text.matchAll(/^(?:static\s+)?(?:inline\s+)?[A-Za-z_][\w\s\*]*?\b([a-z_]\w*)\s*\([^;{]*\)\s*\{/gm)].map(m => m[1]).filter(n => !["if", "for", "while", "switch", "return"].includes(n)).slice(0, 6);
  } else {
    symbols = [...text.matchAll(TS_EXPORT_RE)].map(m => m[2]);
    const head = text.match(/^(?:\s|#![^\n]*\n|(?:import|export\s+\*|export\s+\{)[^\n]*\n|['"]use [^\n]*\n|\/\/[^\n]*\n)*\/\*\*([\s\S]*?)\*\//);
    if (head) summary = cleanDoc(head[1]);
    if (!summary) {
      const fe = text.match(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s/); const first = text.indexOf("\nexport ");
      if (fe && (first < 0 || fe.index <= first + 1)) summary = cleanDoc(fe[1]);
    }
    if (!summary) {
      const srcs = [...text.matchAll(/^export\s+(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/gm)].map(m => base(m[1]).replace(/\.[^.]+$/, ""));
      const names = [...new Set(srcs)];
      if (names.length && names.length >= symbols.length) summary = `Entry module: re-exports ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` and ${names.length - 5} more` : ""}.`;
    }
  }
  const code = stripComments(text, x);
  return { summary, symbols: [...new Set(symbols)].slice(0, 8), entry: entryKind(rel, code, text), routes: routesOf(code), loc: countLines(text) };
}

const TEST_LIBS = /(junit|pytest|mock|jest|vitest|mocha|chai|assert|hamcrest|robolectric|espresso|testcontainers|coverage|lint|eslint|prettier|ruff|black|mypy|flake8|detekt|spotless|typescript$|@types\/|tsx$|ts-node|kover|dokka|animal-sniffer|bnd|japicmp|tox|nox|pre-commit|sphinx|mkdocs)/i;
function dependencies(root) {
  const found = [], add = n => { n = (n || "").trim(); if (n && !TEST_LIBS.test(n) && !found.includes(n)) found.push(n); };
  const tryRead = p => { try { return fs.readFileSync(path.join(root, p), "utf8"); } catch { return null; } };
  const subdirs = (() => { try { return fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")).map(e => e.name); } catch { return []; } })();
  for (const p of ["package.json", ...subdirs.slice(0, 20).map(d => `${d}/package.json`)]) {
    const t = tryRead(p); if (!t) continue; try { Object.keys(JSON.parse(t).dependencies || {}).forEach(add); } catch {}
  }
  for (const p of ["requirements.txt"]) { const t = tryRead(p); if (t) t.split("\n").forEach(l => { const m = l.match(/^\s*([A-Za-z0-9_.\-]+)/); if (m && !/^\s*[#-]/.test(l)) add(m[1]); }); }
  const pp = tryRead("pyproject.toml"); if (pp) { const m = pp.match(/^dependencies\s*=\s*\[([\s\S]*?)\]/m); if (m) [...m[1].matchAll(/["']([A-Za-z0-9_.\-]+)/g)].forEach(x => add(x[1])); }
  const pom = tryRead("pom.xml"); if (pom) [...pom.matchAll(/<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)].forEach(m => add(m[1]));
  const cm = tryRead("CMakeLists.txt");
  if (cm) [...cm.matchAll(/find_package\s*\(\s*([A-Za-z0-9_.+-]+)/gi)].forEach(m => add(m[1]));
  const vcpkg = tryRead("vcpkg.json");
  if (vcpkg) { try { (JSON.parse(vcpkg).dependencies || []).forEach(d => add(typeof d === "string" ? d : d.name)); } catch {} }
  const conan = tryRead("conanfile.txt");
  if (conan) { const m = conan.match(/\[requires\]([\s\S]*?)(\n\[|$)/); if (m) m[1].split("\n").forEach(l => { const n = l.trim().split("/")[0]; if (n) add(n); }); }
  const catalog = new Map(); const toml = tryRead("gradle/libs.versions.toml");
  if (toml) { const sect = toml.match(/^\[libraries\]([\s\S]*?)(^\[|$(?![\s\S]))/m); if (sect) for (const [, alias, body] of sect[1].matchAll(/^([\w.-]+)\s*=\s*(.+)$/gm)) { const m = body.match(/module\s*=\s*"[^:"]+:([^"]+)"/) || body.match(/"[^:"]+:([^:"]+)(?::|")/); if (m) catalog.set(alias.replace(/[-_]/g, ".").toLowerCase(), m[1]); } }
  for (const g of ["build.gradle", "build.gradle.kts", ...subdirs.filter(d => !/(test|sample|build-logic|buildSrc|bom)/i.test(d)).slice(0, 20).flatMap(d => [`${d}/build.gradle`, `${d}/build.gradle.kts`])]) {
    const t = tryRead(g); if (!t) continue;
    [...t.matchAll(/\b(?:implementation|api)\s*\(?\s*["'][^:"']+:([^:"']+)/g)].forEach(m => add(m[1]));
    for (const m of t.matchAll(/\b(?:implementation|api)\s*\(\s*libs\.([\w.]+)/g)) if (catalog.has(m[1].toLowerCase())) add(catalog.get(m[1].toLowerCase()));
  }
  return found.slice(0, 16);
}

export function buildMap(root, name, a, g) {
  const files = discover(root, false);
  const facts = new Map(files.map(f => [f, fileFacts(f, g.texts.get(f) ?? read(root, f))]));
  const { byId, ancestors } = a;
  const pkgFiles = new Map();
  for (const r of a.nodes) { if (!pkgFiles.has(r.group)) pkgFiles.set(r.group, []); pkgFiles.get(r.group).push(r.id); }
  const pOut = new Map(), pIn = new Map(), inflow = new Map();
  for (const [x, y, w] of a.groupEdges) {
    if (!pOut.has(x)) pOut.set(x, []); if (!pIn.has(y)) pIn.set(y, []);
    pOut.get(x).push([y, w]); pIn.get(y).push([x, w]); inflow.set(y, (inflow.get(y) || 0) + w);
  }
  const purpose = fs_ => {
    const dirs = new Map(); fs_.forEach(f => dirs.set(dirname(f), (dirs.get(dirname(f)) || 0) + 1));
    const main = [...dirs].sort((p, q) => q[1] - p[1])[0]?.[0] || "";
    for (const c of ["README.md", "readme.md"]) { const b = readmeBlurb(path.join(root, main, c)); if (b) return cleanDoc(b) || b.slice(0, 180); }
    const pi = read(root, path.posix.join(main, "package-info.java")); if (pi) { const m = pi.match(/\/\*\*([\s\S]*?)\*\//); if (m && cleanDoc(m[1])) return cleanDoc(m[1]); }
    for (const f of fs_) if (f.endsWith("__init__.py") && facts.get(f)?.summary) return facts.get(f).summary;
    return "";
  };
  const packages = [...pkgFiles].map(([p, fs_]) => {
    fs_.sort((x, y) => byId.get(x).rank - byId.get(y).rank);
    const set = new Set(fs_), hit = new Set(); fs_.forEach(f => ancestors.get(f).forEach(v => { if (!set.has(v)) hit.add(v); }));
    return {
      id: p, files: fs_.length, purpose: purpose(fs_), support: fs_.every(f => SUPPORT_RE.test(f)),
      key_files: fs_.slice(0, 3).map(f => ({ path: f, summary: facts.get(f)?.summary || "", symbols: facts.get(f)?.symbols || [] })),
      uses: (pOut.get(p) || []).sort((x, y) => y[1] - x[1]).map(x => x[0]),
      used_by: (pIn.get(p) || []).sort((x, y) => y[1] - x[1]).map(x => x[0]),
      importance: (inflow.get(p) || 0) + fs_.length, dependents: hit.size,
    };
  }).sort((x, y) => (x.support - y.support) || (y.importance - x.importance));
  const start = a.nodes.filter(r => !SUPPORT_RE.test(r.id)).sort((x, y) => (y.fan_in + 0.25 * y.blast) - (x.fan_in + 0.25 * x.blast)).slice(0, 10)
    .map(r => ({ path: r.id, summary: facts.get(r.id)?.summary || "", symbols: (facts.get(r.id)?.symbols || []).slice(0, 4), used_by: r.fan_in }));
  const entries = {}; const routes = [];
  for (const f of files) { const fx = facts.get(f); if (fx.entry) (entries[fx.entry] ||= []).push(f); fx.routes.forEach(r => routes.push({ route: r, file: f })); }
  // Real entry points first; examples, tests and tools only if nothing else qualifies.
  for (const k of Object.keys(entries)) {
    const main = entries[k].filter(f => !SUPPORT_RE.test(f));
    // A program's main file reaches the most code, so the real binaries come first.
    const reachOut = f => { const seen = new Set([f]), st = [f]; while (st.length) for (const w of a.out.get(st.pop()) || []) if (!seen.has(w)) { seen.add(w); st.push(w); } return seen.size; };
    const sizes = new Map(entries[k].map(f => [f, reachOut(f)]));
    entries[k] = (main.length ? main : entries[k]).sort((x, y) => sizes.get(y) - sizes.get(x) || x.localeCompare(y));
  }
  // .h is C++ if the repo has any C++ sources, otherwise C.
  const anyCpp = files.some(f => CPP_SOURCE_EXT.has(ext(f)));
  const lang = f => (ext(f) === ".h" ? (anyCpp ? "c++" : "c") : languageOf(f));
  const langs = {}; files.forEach(f => (langs[lang(f)] = (langs[lang(f)] || 0) + 1));
  const readme = ["README.md", "README.rst", "README.txt", "README", "readme.md"].map(n => path.join(root, n)).find(p => fs.existsSync(p));
  return {
    name, about: readme ? readmeBlurb(readme, name) : "",
    languages: Object.fromEntries(Object.entries(langs).sort((x, y) => y[1] - x[1])), dependencies: dependencies(root),
    counts: { source_files: files.length, connected_files: a.nodes.length, packages: packages.length, imports: a.edgeCount },
    entry_points: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v.slice(0, 12)])),
    routes: routes.slice(0, 60), routes_total: routes.length, start_here: start, packages,
    cycles: a.cycles.filter(c => c.files.length >= 5).slice(0, 3).map(c => ({ size: c.files.length, files: c.files.slice(0, 5) })),
    allFiles: files,
  };
}

const ENTRY = { application: "Applications", main: "Programs (main)", cli: "Command-line tools", http: "HTTP handlers" };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const describe = (s, sym) => s || (sym?.length ? "Defines " + sym.slice(0, 5).map(x => "`" + x + "`").join(", ") + "." : "");

export function mapMarkdown(m, maxPackages = 30) {
  const L = [`# Repo map: ${m.name}`, "", `${m.counts.source_files} source files, ${m.counts.packages} packages. Paths are relative to the repo root.`, "", "## What it is", ""];
  if (m.about) L.push(m.about, "");
  L.push("- Languages: " + Object.entries(m.languages).map(([k, v]) => `${k} (${v} files)`).join(", "));
  if (m.dependencies.length) L.push(`- Main dependencies: ${m.dependencies.slice(0, 12).join(", ")}`);
  L.push("");
  if (Object.keys(m.entry_points).length || m.routes.length) {
    L.push("## Entry points", "");
    for (const k of ["application", "main", "cli", "http"]) if (m.entry_points[k]) L.push(`- ${ENTRY[k]}: ` + m.entry_points[k].slice(0, 8).map(p => "`" + p + "`").join(", "));
    if (m.routes.length) { L.push(`- HTTP routes (${m.routes_total}):`); m.routes.slice(0, 25).forEach(r => L.push(`  - \`${r.route}\` in \`${base(r.file)}\``)); }
    L.push("");
  }
  L.push("## Most imported files", "");
  m.start_here.forEach(s => L.push(`- \`${s.path}\`: ${describe(s.summary, s.symbols)} Imported by ${plural(s.used_by, "file")}.`.replace(": Imported", ": imported")));
  L.push("", "## Packages", "");
  for (const p of m.packages.filter(p => !p.support).slice(0, maxPackages)) {
    L.push(`### ${p.id} (${plural(p.files, "file")})`);
    if (p.purpose) L.push(p.purpose);
    p.key_files.forEach(k => { const d = describe(k.summary, k.symbols); L.push(`- \`${k.path}\`` + (d ? `: ${d}` : "")); });
    const rel = [];
    if (p.uses.length) rel.push("Uses " + p.uses.slice(0, 5).join(", "));
    if (p.used_by.length) rel.push("used by " + p.used_by.slice(0, 5).join(", "));
    if (rel.length) { const s = rel.join("; "); L.push("- " + s[0].toUpperCase() + s.slice(1) + "."); }
    L.push("");
  }
  const sup = m.packages.filter(p => p.support);
  if (sup.length) L.push("Supporting code: " + sup.map(p => `${p.id} (${p.files})`).join(", ") + ".", "");
  if (m.cycles.length) { L.push("## Import cycles", ""); m.cycles.forEach(c => L.push(`- ${c.size} files import each other, including ${c.files.slice(0, 4).map(f => "`" + base(f) + "`").join(", ")}.`)); L.push(""); }
  return L.join("\n") + "\n";
}
