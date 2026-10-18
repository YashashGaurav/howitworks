#!/usr/bin/env node
// howitworks: draw how a repository works.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { buildGraph } from "./lib/scan.mjs";
import { analyze } from "./lib/analyze.mjs";
import { buildMap, mapMarkdown } from "./lib/facts.mjs";
import { buildPrompt, callClaude, parseSpec, validate, archMarkdown, renderHtml, SCHEMA, RULES,
  buildScenarioPrompt, parseScenario, SCENARIO_SCHEMA, SCENARIO_RULES } from "./lib/arch.mjs";

const HELP = `howitworks: draw how a repository works

Usage
  howitworks [repo]                 Generate the diagram and live simulator (needs ANTHROPIC_API_KEY)
  howitworks scan [repo]            Write the prompt for an AI assistant to describe the repo
  howitworks simulate [repo] --spec architecture.json
                                          Add a live simulator to an existing description
  howitworks render [repo] --spec architecture.json [--scenario scenario.json]
                                          Draw the diagram from a description
  howitworks map [repo]             Write REPO_MAP.md, a structural map of the repo

[repo] is a local folder (default: current folder) or a git URL.
Without installing, run any command as: npx howitworks-cli ...

Options
  -o, --out DIR      Where to write files (default: current folder)
  --spec FILE        Architecture description to render instead of generating one
  --scenario FILE    Live simulator to merge into the description when rendering
  --no-sim           Skip generating the live simulator
  --name NAME        Display name
  --model ID         Claude model (default: claude-opus-5-5, or $HOWITWORKS_MODEL)
  --open             Open the diagram in your browser when done
  --bare             HTML body only, for hosts that add the <html> shell
  -h, --help         Show this help

Output
  architecture.html  Interactive diagram: click parts, follow walkthroughs, play a live call if the description has a scenario
  ARCHITECTURE.md    The same content as text, for engineers and AI assistants
  architecture.json  The description the diagram is drawn from; edit it and re-run with --spec

Languages: Python, Java, Kotlin, Scala, TypeScript, JavaScript, C, C++.`;

function parseArgs(argv) {
  const a = { cmd: "diagram", repo: null, out: ".", spec: null, scenario: null, sim: true, name: null, model: process.env.HOWITWORKS_MODEL || "claude-opus-5-5", open: false, bare: false };
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

async function addScenario(spec, root, a, key) {
  const sp = buildScenarioPrompt(root, spec);
  const main = spec.flows[0] ? `"${spec.flows[0].title}"` : "the main path";
  console.log(`Asking ${a.model} to write a live simulator for ${main} (about ${Math.round(sp.length / 4).toLocaleString()} tokens of source) ...`);
  try { spec.scenario = parseScenario(await callClaude(sp, { model: a.model, apiKey: key, maxTokens: 32000 })); }
  catch (e) { console.warn(`warning: could not generate the simulator (${e.message}); continuing without it.`); }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const { root, name: dirName } = resolveRepo(a.repo);
  const name = a.name || dirName;

  const loadJson = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail(`Could not read ${f}: ${e.message}`); } };
  const key = process.env.ANTHROPIC_API_KEY;

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
    const spec = loadJson(a.spec); spec.name = a.name || spec.name || name;
    validate(spec, root);
    const sp = buildScenarioPrompt(root, spec);
    if (!key) {
      const dir = path.join(a.out, ".howitworks"); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "scenario-prompt.md"), sp);
      console.log(`ANTHROPIC_API_KEY is not set. Wrote ${path.join(dir, "scenario-prompt.md")} (about ${Math.round(sp.length / 4).toLocaleString()} tokens).`);
      console.log(`Give it to Claude, save the JSON reply as scenario.json, then run:`);
      console.log(`  npx howitworks-cli render ${a.repo || "."} --spec ${a.spec} --scenario scenario.json --open`);
      return;
    }
    await addScenario(spec, root, a, key);
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
  if (a.cmd === "scan" || !key) {
    const dir = path.join(a.out, ".howitworks"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "prompt.md"), prompt);
    fs.writeFileSync(path.join(dir, "facts.md"), mapMarkdown(map));
    fs.writeFileSync(path.join(dir, "schema.md"), SCHEMA + "\n\n" + RULES + "\n\n# Live simulator\n\nAdd a \"scenario\" key to the same JSON:\n\n" + SCENARIO_SCHEMA + "\n\n" + SCENARIO_RULES.replace(/\nReturn only[^\n]*$/, "") + "\n");
    const why = a.cmd === "scan" ? "" : "ANTHROPIC_API_KEY is not set, so nothing was generated.\n";
    console.log(`\n${why}Wrote ${path.join(dir, "prompt.md")} (about ${Math.round(prompt.length / 4).toLocaleString()} tokens).`);
    console.log(`Next: give it to Claude (Claude Code, claude.ai), save the JSON reply as architecture.json, then run:`);
    console.log(`  npx howitworks-cli render ${a.repo || "."} --spec architecture.json --open`);
    if (!key && a.cmd !== "scan") console.log(`Or set ANTHROPIC_API_KEY and run again to do it in one step.`);
    return;
  }

  console.log(`Asking ${a.model} to describe ${name} (about ${Math.round(prompt.length / 4).toLocaleString()} tokens of context) ...`);
  let spec;
  try { spec = parseSpec(await callClaude(prompt, { model: a.model, apiKey: key })); }
  catch (e) { fail(e.message); }
  spec.name = a.name || spec.name || name;
  fs.mkdirSync(a.out, { recursive: true });
  const specFile = path.join(a.out, "architecture.json");
  if (a.sim) { validate(spec, root); await addScenario(spec, root, a, key); }
  writeOutputs(spec, root, a);
  fs.writeFileSync(specFile, JSON.stringify(spec, null, 1));
  console.log(`  ${specFile}`);
}

main().catch(e => fail(e.stack || String(e)));
