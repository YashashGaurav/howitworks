#!/usr/bin/env node
// howitworks: draw how a repository works.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { buildGraph } from "./lib/scan.mjs";
import { analyze } from "./lib/analyze.mjs";
import { buildMap, mapMarkdown } from "./lib/facts.mjs";
import { buildPrompt, claudeCodeAvailable, runClaudeCode, parseSpec, validate, archMarkdown, renderHtml, SCHEMA, RULES,
  buildScenarioPrompt, parseScenario, SCENARIO_SCHEMA, SCENARIO_RULES } from "./lib/arch.mjs";

const HELP = `howitworks: draw how a repository works

Usage
  howitworks [repo]                 Draw the diagram and live simulator using your Claude Code login
  howitworks simulate [repo] --spec architecture.json
                                    Add a live simulator to an existing description
  howitworks render [repo] --spec architecture.json [--scenario scenario.json]
                                    Check a description and draw it (no Claude needed)
  howitworks scan [repo]            Write the prompt to paste into Claude yourself (no Claude Code needed)
  howitworks map [repo]             Write REPO_MAP.md, a structural map of the repo (no Claude needed)

[repo] is a local folder (default: current folder) or a git URL.
Without installing, run any command as: npx github:koppulapr2230/howitworks ...

Options
  -o, --out DIR      Where to write files (default: current folder)
  --spec FILE        Description to render instead of generating one
  --scenario FILE    Live simulator to merge into the description when rendering
  --no-sim           Skip the live simulator
  --model NAME       Model for Claude Code to use, e.g. sonnet or opus (default: your Claude Code default)
  --name NAME        Display name
  --open             Open the diagram in your browser when done
  --bare             HTML body only, for hosts that add the <html> shell
  -h, --help         Show this help

Requires Claude Code (the "claude" command) installed and logged in, for the commands that use Claude.

Output
  architecture.html  Interactive diagram: click parts, follow walkthroughs, play a live call
  ARCHITECTURE.md    The same content as text, for engineers and AI assistants
  architecture.json  The description the diagram is drawn from; edit it and re-run with --spec

Languages: Python, Java, Kotlin, Scala, TypeScript, JavaScript, C, C++.`;

function parseArgs(argv) {
  const a = { cmd: "diagram", repo: null, out: ".", spec: null, scenario: null, sim: true, name: null, model: null, open: false, bare: false };
  const rest = [...argv];
  if (["scan", "render", "map", "diagram", "simulate"].includes(rest[0])) a.cmd = rest.shift();
  while (rest.length) {
    const t = rest.shift();
    if (t === "-h" || t === "--help") { console.log(HELP); process.exit(0); }
    else if (t === "-o" || t === "--out") a.out = rest.shift();
    else if (t === "--spec") a.spec = rest.shift();
    else if (t === "--scenario") a.scenario = rest.shift();
    else if (t === "--no-sim") a.sim = false;
    else if (t === "--name") a.name = rest.shift();
    else if (t === "--model") a.model = rest.shift();
    else if (t === "--open") a.open = true;
    else if (t === "--bare") a.bare = true;
    else if (t.startsWith("-")) fail(`Unknown option ${t}. Run with --help.`);
    else if (!a.repo) a.repo = t;
    else fail(`Unexpected argument ${t}.`);
  }
  if (a.spec && a.cmd === "diagram") a.cmd = "render";
  return a;
}

function fail(msg) { console.error(`howitworks: ${msg}`); process.exit(1); }

function resolveRepo(target) {
  target ||= ".";
  if (/^(https?:\/\/|git@)/.test(target)) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "howitworks-"));
    console.log(`Cloning ${target} ...`);
    const r = spawnSync("git", ["clone", "--depth", "1", "-q", target, path.join(dir, "repo")], { stdio: "inherit" });
    if (r.status !== 0) fail("git clone failed.");
    return { root: path.join(dir, "repo"), name: target.replace(/\/$/, "").split("/").pop().replace(/\.git$/, "") };
  }
  const root = path.resolve(target);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`Not a folder: ${target}`);
  return { root, name: path.basename(root) };
}

function openFile(file) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", file] : [file];
  try { spawn(cmd, args, { detached: true, stdio: "ignore" }).unref(); } catch {}
}

function scanRepo(root, name) {
  const t = Date.now();
  const g = buildGraph(root);
  let a;
  try { a = analyze(g); } catch (e) { fail(e.message); }
  const map = buildMap(root, name, a, g);
  console.log(`Scanned ${map.counts.source_files} source files, ${map.counts.imports} imports, ${map.counts.packages} packages in ${((Date.now() - t) / 1000).toFixed(1)}s.`);
  return map;
}

function writeOutputs(spec, root, a) {
  const warns = validate(spec, root);
  warns.forEach(w => console.warn(`warning: ${w}`));
  fs.mkdirSync(a.out, { recursive: true });
  const html = path.join(a.out, "architecture.html"), md = path.join(a.out, "ARCHITECTURE.md");
  fs.writeFileSync(html, renderHtml(spec, { bare: a.bare }));
  fs.writeFileSync(md, archMarkdown(spec));
  const flows = spec.flows.length, sim = spec.scenario ? ", live call simulator" : "";
  console.log(`\n${spec.name}: ${spec.nodes.length} parts, ${flows} walkthrough${flows === 1 ? "" : "s"}${sim}.`);
  console.log(`  ${html}\n  ${md}`);
  if (a.open) openFile(path.resolve(html));
}

function requireClaudeCode() {
  if (claudeCodeAvailable()) return;
  fail(`Claude Code is not installed (the "claude" command was not found).
  Install it and log in: https://code.claude.com/docs/en/setup
  Or, without Claude Code: run "howitworks scan", paste .howitworks/prompt.md into Claude,
  save the reply as architecture.json, then "howitworks render --spec architecture.json".`);
}

function taskFile(root, file, text) {
  const dir = path.join(root, ".howitworks"); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, file); fs.writeFileSync(f, text); return f;
}

async function askClaude(file, root, a, what) {
  const t0 = Date.now();
  console.log(`\n${what}. Claude Code is reading the code; this usually takes a few minutes.`);
  const r = await runClaudeCode(file, root, { model: a.model, log: line => console.log(line) });
  console.log(`  done: read ${r.reads} file${r.reads === 1 ? "" : "s"} in ${Math.round((Date.now() - t0) / 1000)}s`);
  return r.text;
}

async function addScenario(spec, root, a) {
  const main = spec.flows[0] ? `"${spec.flows[0].title}"` : "the main path";
  const f = taskFile(root, "scenario-prompt.md", buildScenarioPrompt(root, spec));
  try { spec.scenario = parseScenario(await askClaude(f, root, a, `Writing the live simulator for ${main}`)); }
  catch (e) { console.warn(`warning: could not generate the simulator (${e.message}); continuing without it.`); }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const { root, name: dirName } = resolveRepo(a.repo);
  const name = a.name || dirName;
  const loadJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail(`Could not read ${f}: ${e.message}`); } };

  if (a.cmd === "render") {
    if (!a.spec) fail("render needs --spec architecture.json");
    const spec = loadJson(a.spec);
    if (a.scenario) { const sc = loadJson(a.scenario); spec.scenario = sc.scenario || sc; }
    if (a.name) spec.name = a.name;
    spec.name ||= name;
    return writeOutputs(spec, root, a);
  }

  if (a.cmd === "simulate") {
    if (!a.spec) fail("simulate needs --spec architecture.json");
    requireClaudeCode();
    const spec = loadJson(a.spec); spec.name = a.name || spec.name || name;
    validate(spec, root);
    await addScenario(spec, root, a);
    writeOutputs(spec, root, a);
    fs.writeFileSync(a.spec, JSON.stringify(spec, null, 1));
    return console.log(`  ${a.spec} (updated with the simulator)`);
  }

  const map = scanRepo(root, name);

  if (a.cmd === "map") {
    fs.mkdirSync(a.out, { recursive: true });
    const f = path.join(a.out, "REPO_MAP.md"); fs.writeFileSync(f, mapMarkdown(map));
    return console.log(`  ${f}`);
  }

  const prompt = buildPrompt(root, map);
  if (a.cmd === "scan") {
    const dir = path.join(a.out, ".howitworks"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prompt.md"), prompt);
    fs.writeFileSync(path.join(dir, "facts.md"), mapMarkdown(map));
    fs.writeFileSync(path.join(dir, "schema.md"), SCHEMA + "\n\n" + RULES + "\n\n# Live simulator\n\nAdd a \"scenario\" key to the same JSON:\n\n" + SCENARIO_SCHEMA + "\n\n" + SCENARIO_RULES.replace(/\nReturn only[^\n]*$/, "") + "\n");
    console.log(`\nWrote ${path.join(dir, "prompt.md")} (about ${Math.round(prompt.length / 4).toLocaleString()} tokens).`);
    console.log(`To finish without Claude Code: paste it into Claude, save the JSON reply as architecture.json, then run:`);
    console.log(`  howitworks render ${a.repo || "."} --spec architecture.json --open`);
    return;
  }

  requireClaudeCode();
  const f = taskFile(root, "prompt.md", prompt);
  let spec;
  try { spec = parseSpec(await askClaude(f, root, a, `Describing ${name}`)); }
  catch (e) { fail(e.message); }
  spec.name = a.name || spec.name || name;
  fs.mkdirSync(a.out, { recursive: true });
  const specFile = path.join(a.out, "architecture.json");
  if (a.sim) { validate(spec, root); await addScenario(spec, root, a); }
  writeOutputs(spec, root, a);
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 1));
  console.log(`  ${specFile}`);
}

main().catch(e => fail(e.stack || String(e)));
