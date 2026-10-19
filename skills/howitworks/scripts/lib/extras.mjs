// Small output extras: a Mermaid diagram for ARCHITECTURE.md, links from file paths to the
// repo's web host, and a pointer line for AI assistants' instruction files.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { safeWrite } from "./scan.mjs";

/* ---------- Mermaid ---------- */

// Mermaid text comes from an untrusted description, so labels are reduced to plain text:
// no quotes, angle brackets, backticks (which could end the ``` fence) or line breaks.
const mmText = s => String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/`/g, "'").replace(/"/g, "#quot;")
  .replace(/</g, "#lt;").replace(/>/g, "#gt;").replace(/[{}|[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/** A layered Mermaid flowchart of the description: one subgraph per layer, shapes by kind. */
export function mermaidDiagram(spec, { maxEdges = 150 } = {}) {
  const ids = new Map(); let k = 0;
  const id = raw => { if (!ids.has(raw)) ids.set(raw, `n${k++}`); return ids.get(raw); };
  const shape = n => {
    const t = `"${mmText(n.label || n.id)}"`;
    if (n.kind === "external") return `([${t}])`;
    if (n.kind === "store") return `[(${t})]`;
    return `[${t}]`;
  };
  const L = ["flowchart TD"];
  (spec.groups || []).forEach((g, gi) => {
    const members = (spec.nodes || []).filter(n => n.group === g.id);
    if (!members.length) return;
    L.push(`  subgraph g${gi}["${mmText(g.label || g.id)}"]`, "    direction LR");
    members.forEach(n => L.push(`    ${id(n.id)}${shape(n)}`));
    L.push("  end");
  });
  // Invisible links between consecutive layers keep them stacked top to bottom, as on the page.
  const used = (spec.groups || []).map((g, gi) => (spec.nodes || []).some(n => n.group === g.id) ? `g${gi}` : null).filter(Boolean);
  for (let i = 1; i < used.length; i++) L.push(`  ${used[i - 1]} ~~~ ${used[i]}`);
  const known = new Set((spec.nodes || []).map(n => n.id));
  const edges = (spec.edges || []).filter(e => known.has(e.from) && known.has(e.to)).slice(0, maxEdges);
  edges.forEach(e => {
    const lab = mmText(e.label);
    L.push(`  ${id(e.from)} -->${lab ? `|"${lab}"|` : ""} ${id(e.to)}`);
  });
  const addons = (spec.nodes || []).filter(n => n.kind === "addon" && ids.has(n.id)).map(n => ids.get(n.id));
  const externals = (spec.nodes || []).filter(n => n.kind === "external" && ids.has(n.id)).map(n => ids.get(n.id));
  if (addons.length) L.push("  classDef addon stroke-dasharray: 4 3", `  class ${addons.join(",")} addon`);
  if (externals.length) L.push("  classDef external stroke-dasharray: 2 2", `  class ${externals.join(",")} external`);
  return L.join("\n");
}

/* ---------- Links to files on the repo's web host ---------- */

const git = (root, ...args) => {
  try { const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000 }); return r.status === 0 ? r.stdout.trim() : ""; }
  catch { return ""; }
};

/** Turn a git remote URL into a web URL, dropping any credentials. Returns null if it isn't a known shape. */
export function webBaseFromRemote(remote) {
  if (!remote) return null;
  let host, repoPath;
  let m = remote.match(/^[\w.-]+@([^:/]+):(?!\/)(.+)$/);              // git@github.com:org/repo.git
  if (m) { host = m[1]; repoPath = m[2]; }
  else {
    try {
      const u = new URL(remote.replace(/^git\+/, ""));
      if (!/^(https?|ssh|git):$/.test(u.protocol)) return null;
      host = u.hostname; repoPath = u.pathname;                       // u.username/u.password are dropped
    } catch { return null; }
  }
  repoPath = repoPath.replace(/^\/+/, "").replace(/\.git\/?$/, "").replace(/\/+$/, "");
  if (!host || !repoPath || !/^[\w.~-]+(\/[\w.~-]+)+$/.test(repoPath) || !/^[a-z0-9.-]+$/i.test(host)) return null;
  return `https://${host}/${repoPath}`;
}

/** URL template for a file, with {path} standing for the repo-relative path, for well-known hosts. */
export function linkTemplate(base, ref) {
  if (!base || !ref) return null;
  const host = new URL(base).hostname, r = encodeURIComponent(ref).replace(/%2F/g, "/");
  if (/(^|\.)github(\.|$)/.test(host) || host.startsWith("github.")) return `${base}/blob/${r}/{path}`;
  if (/gitlab/.test(host)) return `${base}/-/blob/${r}/{path}`;
  if (/bitbucket\.org$/.test(host)) return `${base}/src/${r}/{path}`;
  return null;
}

/** Work out a link template for files in a git checkout: the commit if it has been pushed, else the default branch. */
export function detectLinks(root) {
  const base = webBaseFromRemote(git(root, "remote", "get-url", "origin"));
  if (!base) return null;
  const sha = git(root, "rev-parse", "HEAD");
  const pushed = sha && git(root, "branch", "-r", "--contains", sha);
  const defaultBranch = (git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD") || "").replace(/^origin\//, "");
  return linkTemplate(base, pushed ? sha : (defaultBranch || sha));
}

/** Validate a user-supplied template: https only, and it must contain {path}. */
export function checkTemplate(t) {
  if (typeof t !== "string" || !t.includes("{path}")) return "must contain {path}";
  try { const u = new URL(t.replace("{path}", "x")); if (u.protocol !== "https:" && u.protocol !== "http:") return "must be an http(s) URL"; }
  catch { return "is not a valid URL"; }
  return null;
}

/** Fill a template with a repo-relative path, encoding each path segment. */
export const fileUrl = (template, rel) => template.replace("{path}", rel.split("/").map(encodeURIComponent).join("/"));

/* ---------- Pointer for AI assistants ---------- */

const MARK = "<!-- howitworks -->";

/**
 * Add, or refresh, one line in the repo's CLAUDE.md and/or AGENTS.md pointing at ARCHITECTURE.md.
 * Updates whichever of the two exist; creates CLAUDE.md if neither does. Returns the files changed.
 */
export function pointAgents(root, mdFile) {
  const rel = path.relative(root, mdFile).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("ARCHITECTURE.md is outside the repo, so there is nothing to point CLAUDE.md at");
  const line = `${MARK} Read [${rel}](${rel}) for how this codebase is organized (components, main paths, where to make changes) before exploring files. It is generated by howitworks; regenerate it after structural changes.`;
  const targets = ["CLAUDE.md", "AGENTS.md"].filter(f => { try { return fs.lstatSync(path.join(root, f)).isFile(); } catch { return false; } });
  if (!targets.length) targets.push("CLAUDE.md");
  const changed = [];
  for (const f of targets) {
    const file = path.join(root, f);
    let text = ""; try { text = fs.readFileSync(file, "utf8"); } catch {}
    const lines = text.split("\n"), i = lines.findIndex(l => l.startsWith(MARK));
    let next;
    if (i >= 0) { if (lines[i] === line) continue; lines[i] = line; next = lines.join("\n"); }
    else next = text ? text.replace(/\n*$/, "\n\n") + line + "\n" : line + "\n";
    safeWrite(file, next, root);
    changed.push(f);
  }
  return changed;
}
