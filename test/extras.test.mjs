// Tests for the Mermaid diagram, file links and --agents (v0.4.0). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mermaidDiagram, webBaseFromRemote, linkTemplate, detectLinks, checkTemplate, fileUrl, pointAgents } from "../skills/howitworks/scripts/lib/extras.mjs";
import { archMarkdown, renderHtml } from "../skills/howitworks/scripts/lib/arch.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "../skills/howitworks/scripts/cli.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hw-extras-"));
const evil = 'Bad"] --> x[\"`pwn`\"]\n<script>alert(1)</script> {a|b}';
const spec = () => ({ name: "demo", summary: "s", groups: [{ id: "g", label: evil }, { id: "h", label: "Storage" }],
  nodes: [{ id: "end", group: "g", kind: "external", label: evil, files: ["src/a b.py"] }, { id: "db", group: "h", kind: "store", label: "DB", files: [] }, { id: "x", group: "h", kind: "addon", label: "Plugin" }],
  edges: [{ from: "end", to: "db", label: evil }, { from: "db", to: "nope" }], flows: [], changes: [] });

test("Mermaid labels are plain text and can't break out of the diagram or the code fence", () => {
  const m = mermaidDiagram(spec());
  assert.ok(!m.includes("`"), "backtick could end the ``` fence");
  assert.ok(!/<|>(?!\s)/.test(m.replace(/-->/g, "")), "raw angle bracket");
  for (const line of m.split("\n")) assert.ok(!/\n/.test(line));
  // every quoted label has exactly two quotes per label: no injected quote
  for (const l of m.split("\n").filter(l => /"/.test(l))) assert.equal((l.match(/"/g) || []).length % 2, 0, l);
  assert.match(m, /^flowchart TD/);
  assert.match(m, /n0\(\["/, "external shape");
  assert.match(m, /n1\[\("DB"\)\]/, "store shape");
  assert.match(m, /g0 ~~~ g1/, "layers stacked");
  assert.ok(!m.includes("nope"), "edge to an unknown node dropped");
  assert.ok(!/\bend\[/.test(m), "spec ids are never used as Mermaid ids");
  const md = archMarkdown(spec());
  const fence = md.match(/```mermaid\n([\s\S]*?)\n```/);
  assert.ok(fence, "ARCHITECTURE.md has a mermaid block");
  assert.ok(!fence[1].includes("```"));
});

test("remote URLs become web links without credentials", () => {
  assert.equal(webBaseFromRemote("git@github.com:org/repo.git"), "https://github.com/org/repo");
  assert.equal(webBaseFromRemote("https://user:ghp_SECRET@github.com/org/repo.git"), "https://github.com/org/repo");
  assert.equal(webBaseFromRemote("https://oauth2:glpat-SECRET@gitlab.example.com/group/sub/repo"), "https://gitlab.example.com/group/sub/repo");
  assert.equal(webBaseFromRemote("ssh://git@gitlab.com/group/repo.git"), "https://gitlab.com/group/repo");
  for (const bad of ["", "file:///etc/passwd", "ext::sh -c touch% /tmp/x", "/local/path/repo", "https://github.com/", "javascript:alert(1)//github.com/a/b", "https://evil.com/a\"onmouseover=x/b"])
    assert.equal(webBaseFromRemote(bad), null, bad);
  assert.equal(linkTemplate("https://github.com/o/r", "abc123"), "https://github.com/o/r/blob/abc123/{path}");
  assert.equal(linkTemplate("https://gitlab.com/g/r", "main"), "https://gitlab.com/g/r/-/blob/main/{path}");
  assert.equal(linkTemplate("https://bitbucket.org/t/r", "main"), "https://bitbucket.org/t/r/src/main/{path}");
  assert.equal(linkTemplate("https://git.example.com/t/r", "main"), null, "unknown hosts need --links");
  assert.equal(fileUrl("https://github.com/o/r/blob/x/{path}", "src/a b#c.py"), "https://github.com/o/r/blob/x/src/a%20b%23c.py");
});

test("links are detected from the repo's own remote, never from the description", () => {
  const dir = tmp();
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q"); g("remote", "add", "origin", "https://user:SECRET@github.com/org/repo.git");
  fs.writeFileSync(path.join(dir, "a.py"), "x=1\n"); g("add", "."); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x");
  const t = detectLinks(dir);
  assert.match(t, /^https:\/\/github\.com\/org\/repo\/blob\/[0-9a-f]{40}\/\{path\}$/);
  assert.ok(!t.includes("SECRET"));
  const s = spec(); s.links = "javascript:alert(1)//{path}";
  const html = renderHtml(s);
  assert.ok(!html.includes("javascript:alert"), "a description can't set the link template");
  assert.ok(checkTemplate("javascript:alert(1)//{path}"));
  assert.ok(checkTemplate("https://x.com/no-placeholder"));
  assert.equal(checkTemplate("https://git.example.com/r/blob/main/{path}"), null);
  const ok = renderHtml(spec(), { links: "https://github.com/o/r/blob/main/{path}" });
  assert.ok(ok.includes('"links":"https://github.com/o/r/blob/main/{path}"'));
  assert.ok(renderHtml(spec(), { links: "javascript:x//{path}" }).includes('"links":null'));
});

test("--agents adds one line to CLAUDE.md / AGENTS.md, idempotently and safely", () => {
  const root = tmp(); fs.mkdirSync(path.join(root, "docs"));
  const md = path.join(root, "docs/ARCHITECTURE.md"); fs.writeFileSync(md, "# x\n");
  assert.deepEqual(pointAgents(root, md), ["CLAUDE.md"], "creates CLAUDE.md when neither exists");
  assert.match(fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8"), /^<!-- howitworks --> Read \[docs\/ARCHITECTURE\.md\]\(docs\/ARCHITECTURE\.md\)/);
  assert.deepEqual(pointAgents(root, md), [], "second run changes nothing");
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Agents\n\nBe nice.\n");
  assert.deepEqual(pointAgents(root, md), ["AGENTS.md"]);
  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  assert.ok(agents.startsWith("# Agents\n\nBe nice.\n\n<!-- howitworks -->"), "keeps existing content");
  assert.equal(agents.match(/<!-- howitworks -->/g).length, 1);
  // a symlinked CLAUDE.md is never written through
  const root2 = tmp(), outside = path.join(tmp(), "victim.md"); fs.writeFileSync(outside, "keep\n");
  fs.symlinkSync(outside, path.join(root2, "CLAUDE.md"));
  assert.throws(() => pointAgents(root2, path.join(root2, "ARCHITECTURE.md")), /symbolic link/);
  assert.equal(fs.readFileSync(outside, "utf8"), "keep\n");
  assert.throws(() => pointAgents(root, path.join(tmp(), "ARCHITECTURE.md")), /outside the repo/);
});

test("CLI: --links, --no-links and --agents end to end", () => {
  const root = tmp(); fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/a.py"), "import b\n"); fs.writeFileSync(path.join(root, "src/b.py"), "X=1\n");
  const sp = path.join(root, "spec.json");
  fs.writeFileSync(sp, JSON.stringify({ name: "x", groups: [{ id: "g", label: "G" }], nodes: [{ id: "a", group: "g", label: "A", files: ["src/a.py"] }], edges: [], flows: [], changes: [] }));
  const run = (...a) => spawnSync(process.execPath, [CLI, "render", root, "--spec", sp, ...a], { encoding: "utf8" });
  assert.notEqual(run("--links", "javascript:x//{path}").status, 0);
  let r = run("-o", path.join(root, "docs"), "--links", "https://git.example.com/t/r/blob/main/{path}", "--agents");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(root, "docs/architecture.html"), "utf8").includes("https://git.example.com/t/r/blob/main/{path}"));
  assert.ok(fs.readFileSync(path.join(root, "docs/ARCHITECTURE.md"), "utf8").includes("[`src/a.py`](../src/a.py)"), "relative link inside the repo");
  assert.ok(fs.existsSync(path.join(root, "CLAUDE.md")));
  r = run("-o", path.join(root, "docs"), "--no-links");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(root, "docs/ARCHITECTURE.md"), "utf8").includes("Files: `src/a.py`."));
  assert.ok(fs.readFileSync(path.join(root, "docs/architecture.html"), "utf8").includes('"links":null'));
});
