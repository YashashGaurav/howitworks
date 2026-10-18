// File discovery and import resolution for Python, Java, Kotlin, Scala,
// TypeScript and JavaScript. Edge A -> B means "A imports B".
import fs from "node:fs";
import path from "node:path";

export const SKIP_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "bower_components", "dist", "build", "out", "target",
  ".gradle", ".idea", ".vscode", "venv", ".venv", "env", "__pycache__", ".mypy_cache",
  ".pytest_cache", ".tox", "site-packages", "coverage", ".next", ".nuxt", ".turbo", ".cache",
  "vendor", "third_party", "3rdparty", "thirdparty", "subprojects", "extern", "deps",
]);
const TEST_DIR_RE = /(^|\/)([\w.-]*[-_.]tests?|tests?|__tests__|__mocks__|testing|test-?fixtures|spec|specs|e2e|fixtures?|testFixtures|src\/(?:\w+)?Test)(\/|$)/;
const EXTRA_DIR_RE = /^(?:[^/]+\/)?(examples?|samples?|demos?|docs?|benchmarks?)(\/|$)/;
const TEST_FILE_RE = /(^test_.*\.py$|_test\.py$|\.(test|spec)\.[jt]sx?$|Tests?\.(java|kt|scala)$|^conftest\.py$|(_test|_unittest|_tests|_bench|_benchmark|Test|Tests)\.(c|cc|cpp|cxx|c\+\+)$|^test_.*\.(c|cc|cpp|cxx)$)/;

export const PY_EXT = new Set([".py"]);
export const JVM_EXT = new Set([".java", ".kt", ".kts", ".scala"]);
export const JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
export const CPP_EXT = new Set([".c", ".cc", ".cpp", ".cxx", ".c++", ".cu", ".h", ".hh", ".hpp", ".hxx", ".h++", ".ipp", ".inl", ".tpp", ".cuh"]);
export const CPP_SOURCE_EXT = new Set([".cc", ".cpp", ".cxx", ".c++", ".cu", ".hh", ".hpp", ".hxx", ".h++", ".ipp", ".tpp", ".cuh"]);
const ALL_EXT = new Set([...PY_EXT, ...JVM_EXT, ...JS_EXT, ...CPP_EXT]);

export const ext = f => path.extname(f);
export const base = f => f.split("/").pop();
export const dirname = f => { const i = f.lastIndexOf("/"); return i < 0 ? "" : f.slice(0, i); };

export function discover(root, includeTests = false) {
  const out = [];
  const walk = rel => {
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    if (!includeTests && rel && (TEST_DIR_RE.test(rel) || EXTRA_DIR_RE.test(rel) || (rel + "/").includes("src/test/"))) return;
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(r);
      } else if (e.isFile()) {
        const x = ext(e.name);
        if (!ALL_EXT.has(x) || e.name.endsWith(".d.ts") || e.name.endsWith(".min.js")) continue;
        if (!includeTests && TEST_FILE_RE.test(e.name)) continue;
        out.push(r);
      }
    }
  };
  walk("");
  return out.sort();
}

// Files above this size are skipped: generated code, data dumps or a hostile repo.
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const realRoots = new Map();
const realRoot = root => { if (!realRoots.has(root)) { let r; try { r = fs.realpathSync(root); } catch { r = path.resolve(root); } realRoots.set(root, r); } return realRoots.get(root); };

/** Absolute real path of root/rel if it is a regular file inside root (after following symlinks), else null. */
export function insideRepo(root, rel) {
  if (typeof rel !== "string" || !rel || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const base = realRoot(root);
  let real; try { real = fs.realpathSync(path.join(root, rel)); } catch { return null; }
  if (real !== base && !real.startsWith(base + path.sep)) return null;
  try { if (!fs.statSync(real).isFile()) return null; } catch { return null; }
  return real;
}

/** Text of a file in the repo, or null if it is missing, outside the repo, or too large. */
export function readOrNull(root, rel) {
  const real = insideRepo(root, rel); if (!real) return null;
  try { if (fs.statSync(real).size > MAX_FILE_BYTES) return null; return fs.readFileSync(real, "utf8"); } catch { return null; }
}

export function read(root, rel) { return readOrNull(root, rel) ?? ""; }

/**
 * Write a file under baseDir without following symlinks. A scanned repo can ship
 * symlinks at the paths howitworks writes (.howitworks/prompt.md, architecture.html, ...)
 * pointing at files elsewhere, so: the folder must resolve inside baseDir, and the
 * file itself must be absent or a plain, singly linked file.
 */
export function safeWrite(file, data, baseDir = path.dirname(file)) {
  const dir = path.dirname(path.resolve(file));
  fs.mkdirSync(dir, { recursive: true });
  const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const base = real(baseDir), rdir = real(dir);
  if (rdir !== base && !rdir.startsWith(base + path.sep)) throw new Error(`refusing to write ${file}: its folder leads outside ${baseDir}`);
  let st = null; try { st = fs.lstatSync(file); } catch {}
  if (st && (!st.isFile() || st.nlink > 1)) throw new Error(`refusing to write ${file}: it is a ${st.isSymbolicLink() ? "symbolic link" : st.isFile() ? "hard link" : "not a regular file"}`);
  const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | NOFOLLOW, 0o644);
  try { fs.writeFileSync(fd, data); } finally { fs.closeSync(fd); }
}

export const countLines = t => t.split("\n").filter(l => l.trim()).length;

export function isTestFile(rel) {
  const name = base(rel), d = dirname(rel), x = ext(name);
  if (PY_EXT.has(x)) return name.startsWith("test_") || name.endsWith("_test.py");
  if (JS_EXT.has(x)) return /\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || `/${d}/`.includes("/__tests__/");
  if (CPP_EXT.has(x)) return /(_test|_unittest|_tests|Test|Tests)\.(c|cc|cpp|cxx|c\+\+)$/.test(name) || /^test_.*\.(c|cc|cpp|cxx)$/.test(name) || /(^|\/)(tests?|unittests?)(\/|$)/.test(d);
  return /(Test|Tests|IT|Spec)\.(java|kt|scala)$/.test(name) || /(^|\/)src\/(test|\w+Test)(\/|$)/.test(d);
}

export function languageOf(rel) {
  const x = ext(rel);
  if (x === ".py") return "python";
  if (x === ".java") return "java";
  if (x === ".kt" || x === ".kts") return "kotlin";
  if (x === ".scala") return "scala";
  if ([".ts", ".tsx", ".mts", ".cts"].includes(x)) return "typescript";
  if (x === ".c") return "c";
  if (CPP_EXT.has(x)) return "c++";
  return "javascript";
}

// ---------------------------------------------------------------- Python
/** Replace string literals (incl. docstrings) with blanks, keeping line numbers. */
export function blankPyStrings(text) {
  return text.replace(/("""|''')[\s\S]*?\1/g, m => m.replace(/[^\n]/g, " "))
             .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, m => '"' + " ".repeat(Math.max(0, m.length - 2)) + '"');
}

export class PythonResolver {
  constructor(files, typeImports = false) {
    this.typeImports = typeImports;
    this.files = files.filter(f => f.endsWith(".py"));
    const set = new Set(this.files);
    const roots = new Set(["", "src", "lib", "python"]);
    for (const f of this.files) {
      const parts = f.split("/");
      for (let i = 0; i < parts.length - 1; i++) {
        const pkg = parts.slice(0, i + 1).join("/"), parent = parts.slice(0, i).join("/");
        if (set.has(`${pkg}/__init__.py`) && (!parent || !set.has(`${parent}/__init__.py`))) { roots.add(parent); break; }
      }
    }
    this.roots = [...roots].sort((a, b) => b.length - a.length);
    this.modules = new Map(); this.moduleOf = new Map();
    for (const f of this.files) {
      for (const r of this.roots) {
        if (r && !f.startsWith(r + "/")) continue;
        let mod = (r ? f.slice(r.length + 1) : f).slice(0, -3).replace(/\//g, ".");
        if (mod.endsWith(".__init__")) mod = mod.slice(0, -9);
        else if (mod === "__init__") continue;
        if (!this.modules.has(mod)) this.modules.set(mod, f);
      }
    }
    for (const [mod, f] of this.modules) if (!this.moduleOf.has(f) || mod.length > this.moduleOf.get(f).length) this.moduleOf.set(f, mod);
  }
  lookup(name) {
    while (name) {
      if (this.modules.has(name)) return this.modules.get(name);
      const i = name.lastIndexOf("."); if (i < 0) return null; name = name.slice(0, i);
    }
    return null;
  }
  deps(rel, text) {
    const out = new Set();
    const me = this.moduleOf.get(rel) || "";
    const isPkg = rel.endsWith("__init__.py");
    const pkg = isPkg ? me : (me.includes(".") ? me.slice(0, me.lastIndexOf(".")) : "");
    const lines = blankPyStrings(text).split("\n");
    let skipIndent = -1;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const ind = line.match(/^\s*/)[0].length;
      if (skipIndent >= 0) { if (!line.trim() || ind > skipIndent) continue; skipIndent = -1; }
      if (!this.typeImports && /^\s*if\s+(?:\w+\.)?TYPE_CHECKING\b/.test(line)) { skipIndent = ind; continue; }
      line = line.replace(/#.*/, "");
      let m;
      if ((m = line.match(/^\s*import\s+(.+)$/))) {
        for (const part of m[1].split(",")) { const t = this.lookup(part.trim().split(/\s+as\s+/)[0].trim()); if (t) out.add(t); }
      } else if ((m = line.match(/^\s*from\s+(\.*)([\w.]*)\s+import\s+(.*)$/))) {
        let names = m[3];
        if (names.includes("(") && !names.includes(")")) { let j = i + 1; while (j < lines.length && !lines[j].includes(")")) names += " " + lines[j++]; if (j < lines.length) names += " " + lines[j]; }
        names = names.replace(/[()\\]/g, " ");
        const level = m[1].length; let full;
        if (level) {
          const bp = pkg ? pkg.split(".") : []; const up = level - 1;
          if (up > bp.length) continue;
          const b = (up ? bp.slice(0, bp.length - up) : bp).join(".");
          full = m[2] ? (b ? `${b}.${m[2]}` : m[2]) : b;
        } else full = m[2];
        if (!full) continue;
        let hitSub = false;
        for (const n of names.split(",").map(x => x.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) {
          if (n !== "*" && this.modules.has(`${full}.${n}`)) { out.add(this.modules.get(`${full}.${n}`)); hitSub = true; }
        }
        if (!hitSub || this.modules.has(full)) { const t = this.lookup(full); if (t) out.add(t); }
      }
    }
    out.delete(rel); return out;
  }
}

// ---------------------------------------------------------------- JVM
const PKG_RE = /^\s*package\s+([\w.]+)/m;
const JVM_IMPORT_RE = /^\s*import\s+(static\s+)?([\w.]+)(\.\*)?\s*(?:as\s+\w+)?\s*;?/gm;
const SCALA_IMPORT_RE = /^\s*import\s+([\w.]+?)\.?(\{[^}]*\}|_|\*)?\s*$/gm;
const IDENT_RE = /\b[A-Z][A-Za-z0-9_]*\b/g;
const COMMENT_RE = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const STRING_RE = /"(?:\\.|[^"\\])*"/g;
export const KT_TOPLEVEL_RE = /^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|inline|suspend|operator|infix|tailrec|const|expect|actual)\s+)*(?:fun\s+(?:<[^>]+>\s*)?(?:[\w.<>?, *]+\.)?|va[lr]\s+(?:[\w.<>?, *]+\.)?)(\w+)/gm;
const KT_DECL_RE = /^\s*(?:(?:data|sealed|open|abstract|enum|inner|internal|private|public|case|final|implicit)\s+)*(?:class|interface|object|trait)\s+([A-Z]\w*)/gm;

export class JvmResolver {
  constructor(files, texts) {
    this.files = files.filter(f => JVM_EXT.has(ext(f)));
    this.pkgOf = new Map(); this.byFqn = new Map(); this.byPkg = new Map();
    const addPkg = (p, c, f, force = false) => { if (!this.byPkg.has(p)) this.byPkg.set(p, new Map()); if (force || !this.byPkg.get(p).has(c)) this.byPkg.get(p).set(c, f); };
    for (const f of this.files) {
      const t = texts.get(f), m = t.match(PKG_RE), pkg = m ? m[1] : "";
      this.pkgOf.set(f, pkg);
      const stem = base(f).replace(/\.[^.]+$/, "");
      // A file named after a class wins over another file that also declares it.
      this.byFqn.set(pkg ? `${pkg}.${stem}` : stem, f); addPkg(pkg, stem, f, true);
      if (/\.(kt|kts|scala)$/.test(f)) {
        for (const cm of t.matchAll(KT_DECL_RE)) { const fq = pkg ? `${pkg}.${cm[1]}` : cm[1]; if (!this.byFqn.has(fq)) this.byFqn.set(fq, f); addPkg(pkg, cm[1], f); }
        if (!f.endsWith(".scala")) for (const fm of t.matchAll(KT_TOPLEVEL_RE)) { const fq = pkg ? `${pkg}.${fm[1]}` : fm[1]; if (!this.byFqn.has(fq)) this.byFqn.set(fq, f); }
      }
    }
  }
  walkBack(name, out) {
    let n = name;
    while (n) {
      if (this.byFqn.has(n)) { out.add(this.byFqn.get(n)); return; }
      const i = n.lastIndexOf("."); if (i < 0) return; n = n.slice(0, i);
    }
  }
  usedIn(text) { return new Set(text.replace(COMMENT_RE, " ").replace(STRING_RE, " ").match(IDENT_RE) || []); }
  deps(rel, text) {
    const out = new Set();
    let used = null; const getUsed = () => (used ||= this.usedIn(text));
    if (rel.endsWith(".scala")) {
      for (const m of text.matchAll(SCALA_IMPORT_RE)) {
        const b = m[1].replace(/\.$/, ""), sel = m[2];
        const names = sel && sel.startsWith("{") ? sel.slice(1, -1).split(",").map(x => x.split("=>")[0].trim()) : [];
        if (sel === "_" || sel === "*" || names.includes("_") || names.includes("*")) {
          const p = this.byPkg.get(b); if (p) for (const [c, f] of p) if (getUsed().has(c)) out.add(f);
        }
        for (const nm of names.length ? names : [""]) this.walkBack(nm && nm !== "_" && nm !== "*" ? `${b}.${nm}` : b, out);
      }
    }
    for (const m of text.matchAll(JVM_IMPORT_RE)) {
      if (rel.endsWith(".scala")) break;
      const name = m[2];
      if (m[3] && this.byPkg.has(name)) { for (const [c, f] of this.byPkg.get(name)) if (getUsed().has(c)) out.add(f); continue; }
      this.walkBack(name, out);
    }
    const sib = this.byPkg.get(this.pkgOf.get(rel) || "");
    if (sib) for (const [c, f] of sib) if (getUsed().has(c)) out.add(f);
    out.delete(rel); return out;
  }
}

// ---------------------------------------------------------------- JS / TS
const JS_IMPORT_RES = [
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];
const JS_TYPE_ONLY_RE = /\b(?:import|export)\s+type\s+[^'"]*?from\s+['"][^'"]+['"]/g;
const JS_BRACE_IMPORT_RE = /\bimport\s*\{([^}]*)\}\s*from\s+['"][^'"]+['"]/g;
const RESOLVE_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const stripJsonComments = s => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"\\])\/\/[^\n]*/g, "$1").replace(/,(\s*[}\]])/g, "$1");
const norm = p => { const n = path.posix.normalize(p); return n === "." ? "" : n; };

function findFiles(root, name, limit = 400) {
  const out = [];
  const walk = (rel, depth) => {
    if (out.length >= limit || depth > 6) return;
    let es; try { es = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(r, depth + 1); }
      else if (typeof name === "string" ? e.name === name : name.test(e.name)) out.push(r);
    }
  };
  walk("", 0); return out;
}

export class JsResolver {
  constructor(root, files, typeImports = false) {
    this.typeImports = typeImports;
    this.fileset = new Set(files.filter(f => JS_EXT.has(ext(f))));
    this.aliases = []; this.packages = new Map();
    if (!this.fileset.size) return;
    for (const cfg of findFiles(root, /^(tsconfig.*|jsconfig)\.json$/)) {
      let data; try { data = JSON.parse(stripJsonComments(read(root, cfg))); } catch { continue; }
      const co = (data && data.compilerOptions) || {}, cdir = dirname(cfg);
      const b = norm(path.posix.join(cdir || ".", co.baseUrl || "."));
      for (const [k, targets] of Object.entries(co.paths || {})) this.aliases.push([cdir, k.replace(/\*$/, ""), targets.map(t => norm(path.posix.join(b || ".", t.replace(/\*$/, ""))))]);
      if (co.baseUrl) this.aliases.push([cdir, "", [b]]);
    }
    this.aliases.sort((a, b) => b[1].length - a[1].length);
    for (const pj of findFiles(root, "package.json")) {
      try { const d = JSON.parse(read(root, pj)); if (d && d.name) this.packages.set(d.name, dirname(pj)); } catch {}
    }
  }
  probe(b) {
    b = norm(b); if (b.startsWith("..")) return null;
    for (const x of RESOLVE_EXT) if (this.fileset.has(b + x)) return b + x;
    const m = b.match(/^(.*)\.(js|jsx|mjs|cjs)$/);
    if (m) for (const x of [".ts", ".tsx", ".mts", ".cts"]) if (this.fileset.has(m[1] + x)) return m[1] + x;
    for (const sub of ["index", "src/index"]) for (const x of RESOLVE_EXT.slice(1)) { const c = b ? `${b}/${sub}${x}` : `${sub}${x}`; if (this.fileset.has(c)) return c; }
    return null;
  }
  resolve(rel, spec) {
    if (spec.startsWith(".")) return this.probe(path.posix.join(dirname(rel) || ".", spec));
    for (const [cdir, prefix, targets] of this.aliases) {
      if (cdir && !rel.startsWith(cdir + "/")) continue;
      if (prefix && !spec.startsWith(prefix)) continue;
      if (!prefix && this.packages.has(spec)) continue;
      const rest = spec.slice(prefix.length);
      for (const t of targets) { const h = this.probe(t ? `${t}/${rest}` : rest); if (h) return h; }
    }
    for (const [name, d] of this.packages) {
      if (spec === name || spec.startsWith(name + "/")) { const rest = spec.slice(name.length).replace(/^\//, ""); return this.probe([d, rest].filter(Boolean).join("/") || "index"); }
    }
    return null;
  }
  deps(rel, text) {
    const out = new Set();
    let body = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, " ");
    if (!this.typeImports) {
      body = body.replace(JS_TYPE_ONLY_RE, " ").replace(JS_BRACE_IMPORT_RE, (m, items) => {
        const xs = items.split(",").map(s => s.trim()).filter(Boolean);
        return xs.length && xs.every(x => x.startsWith("type ")) ? " " : m;
      });
    }
    for (const rx of JS_IMPORT_RES) for (const m of body.matchAll(rx)) { const t = this.resolve(rel, m[1]); if (t) out.add(t); }
    out.delete(rel); return out;
  }
}

// ---------------------------------------------------------------- C / C++
const INCLUDE_RE = /^[ \t]*#[ \t]*(?:include|import)[ \t]*([<"])([^>"\n]+)[>"]/gm;

/** Resolves #include "x/y.h" and <x/y.h> to repo files without needing the
 *  build system: first relative to the including file, then by matching the
 *  path as a suffix of a repo file, preferring the closest one. */
export class CppResolver {
  constructor(files) {
    this.fileset = new Set(files.filter(f => CPP_EXT.has(ext(f))));
    this.byBase = new Map();
    for (const f of this.fileset) { const b = base(f); if (!this.byBase.has(b)) this.byBase.set(b, []); this.byBase.get(b).push(f); }
  }
  resolve(rel, inc, quoted) {
    inc = inc.trim().replace(/^\.\//, "");
    if (quoted || inc.includes("/")) {
      const local = path.posix.normalize(path.posix.join(dirname(rel) || ".", inc));
      if (this.fileset.has(local)) return local;
    }
    const cands = (this.byBase.get(base(inc)) || []).filter(f => f === inc || f.endsWith("/" + inc));
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0];
    const common = f => { const a = dirname(rel).split("/"), b = f.split("/"); let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };
    return cands.sort((a, b) => common(b) - common(a) || a.length - b.length)[0];
  }
  deps(rel, text) {
    const out = new Set();
    const body = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
    for (const m of body.matchAll(INCLUDE_RE)) { const t = this.resolve(rel, m[2], m[1] === '"'); if (t) out.add(t); }
    out.delete(rel); return out;
  }
}

export function buildGraph(root, { includeTests = false, typeImports = false } = {}) {
  const files = discover(root, includeTests);
  const texts = new Map(files.map(f => [f, read(root, f)]));
  const py = new PythonResolver(files, typeImports), jvm = new JvmResolver(files, texts), js = new JsResolver(root, files, typeImports), cpp = new CppResolver(files);
  const out = new Map(files.map(f => [f, new Set()]));
  for (const f of files) {
    const x = ext(f);
    const d = PY_EXT.has(x) ? py.deps(f, texts.get(f)) : JVM_EXT.has(x) ? jvm.deps(f, texts.get(f)) : CPP_EXT.has(x) ? cpp.deps(f, texts.get(f)) : js.deps(f, texts.get(f));
    for (const t of d) out.get(f).add(t);
  }
  return { files, texts, out, py, jvm };
}
