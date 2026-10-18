# howitworks

**See how a codebase works, not just what files it has.**

howitworks reads a repository and produces an interactive page that explains it: the main parts and how they connect, guided walkthroughs of the important paths, and a live simulator that sends a request through the code step by step. The same explanation is written to `ARCHITECTURE.md`, so engineers and AI assistants can read it too.

It runs as a **Claude skill** (in Claude Code or the Claude app) or as a **command line tool**.

Supported languages: Python, Java, Kotlin, Scala, TypeScript, JavaScript, C and C++.

---

## Contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Install](#install)
  - [Claude Code](#claude-code)
  - [Claude app (claude.ai)](#claude-app-claudeai)
  - [Command line](#command-line)
- [Quick start](#quick-start)
- [Using the skill](#using-the-skill)
- [Using the command line](#using-the-command-line)
- [The interactive page](#the-interactive-page)
- [How it works](#how-it-works)
- [Language support](#language-support)
- [The description format](#the-description-format)
- [Keeping it up to date](#keeping-it-up-to-date)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Project layout](#project-layout)
- [Publishing](#publishing)
- [License](#license)

---

## What you get

Every run produces three files:

| File | What it is |
|---|---|
| `architecture.html` | The interactive page. One self-contained file: open it in any browser, share it, or host it. |
| `ARCHITECTURE.md` | The same explanation as text. Commit it next to your README and point your AI assistant at it. |
| `architecture.json` | The description the page is drawn from. Edit it and re-render at any time. |

The page contains:

- **A layered diagram** of 12 to 28 components, from the callers at the top to storage and I/O at the bottom. Click any box to see what it does, which files it lives in, and what it talks to.
- **Guided tours** of the 2 to 4 most important paths, such as "Send a request" or "Create a topic", with each step numbered on the diagram.
- **A live simulator.** Choose how a call should go (cache hit or miss, validation error, retry, leader moved, and so on), press **Send**, and watch it travel through the diagram while each step is narrated, the payload in flight is shown, and an event log fills in with real function names from the code.
- **Where to make a change**: common tasks mapped to the components you would edit.

---

## Requirements

- **Node.js 18 or newer** (`node --version`). No other dependencies.
- **git**, only if you pass a Git URL instead of a local folder.
- **Claude**, through either:
  - [Claude Code](https://code.claude.com/docs/en/setup), installed and logged in. The skill runs inside it, and the command line tool uses it (the `claude` command) to read the code and write the description. There is no API key to set up: it uses your existing Claude login.
  - the Claude app, to use it as a skill there.

---

## Install

### Claude Code

Install the skill for your user account, so it is available in every project:

```bash
npx skills add koppulapr2230/howitworks -g -a claude-code --copy
```

| Flag | Meaning |
|---|---|
| `-g` | Install for your user account instead of one project. |
| `-a claude-code` | Install for Claude Code only. Leave it out to install for every supported agent. |
| `--copy` | Copy the files into `~/.claude/skills/howitworks` instead of linking to them. |

Check the install:

```bash
ls ~/.claude/skills/howitworks
# SKILL.md  examples  scripts  templates
```

Then **start a new Claude Code session** (`claude`) inside a repo and type `/howitworks`. Sessions that were already open do not see a newly installed skill.

**Manual install, without the installer:**

```bash
git clone --depth 1 https://github.com/koppulapr2230/howitworks.git /tmp/howitworks
mkdir -p ~/.claude/skills
cp -R /tmp/howitworks/skills/howitworks ~/.claude/skills/
```

### Claude app (claude.ai)

1. Build the skill ZIP from this repo:
   ```bash
   git clone --depth 1 https://github.com/koppulapr2230/howitworks.git
   cd howitworks/skills && zip -r howitworks.zip howitworks
   ```
2. In Claude, open **Settings > Capabilities** and turn on **Code execution and file creation**. Skills need it.
3. Go to **Customize > Skills**, click **+**, then **+ Create skill > Upload a skill**, choose `howitworks.zip`, and turn it on.

**For a whole Team or Enterprise organization:** an owner uploads the same ZIP under **Organization settings > Plugins & skills > Add > Upload a skill**. It becomes available to everyone in the organization immediately.

In the Claude app, attach your repo as a `.zip` or give a Git URL. If your network settings block GitHub, attach a `.zip` instead.

### Command line

```bash
# Install the "howitworks" command
npm install -g github:koppulapr2230/howitworks
howitworks --help

# Or run it without installing
npx github:koppulapr2230/howitworks --help
```

Once the package is published to npm (see [Publishing](#publishing)), this becomes `npx howitworks-cli`. The npm package is named `howitworks-cli` because `howitworks` is taken on npm; the command it installs is still `howitworks`.

---

## Quick start

**In Claude Code**, inside any repo:

```
/howitworks
```

**From the command line**, with Claude Code installed and logged in:

```bash
cd /path/to/your/repo
howitworks . --open
```

The tool runs Claude Code in headless mode with read-only access to the repo (it can read and search files, nothing else) and shows each file Claude opens as it goes.

**Try it with no setup**, using an included example:

```bash
git clone --depth 1 https://github.com/spring-projects/spring-petclinic.git
git clone --depth 1 https://github.com/koppulapr2230/howitworks.git
npx github:koppulapr2230/howitworks render spring-petclinic \
  --spec howitworks/skills/howitworks/examples/petclinic.architecture.json --open
```

---

## Using the skill

`/howitworks` on its own diagrams the whole repo and picks the most important path for the simulator. A sentence of direction usually gets a better result.

| Goal | Prompt |
|---|---|
| Choose what the simulator plays | `/howitworks Simulate a payment request from the API to the ledger write. Include a duplicate request, a validation failure and a downstream timeout.` |
| Focus on part of a large repo | `/howitworks Only services/settlement. Show the other services it calls as external boxes.` |
| Write for an audience | `/howitworks For new engineers: explain startup and how config is loaded. About 15 parts.` |
| A repo you don't have locally | `/howitworks https://github.com/org/repo` |
| Refresh after code changes | `/howitworks Update .howitworks/architecture.json for this branch. Keep the walkthroughs and re-check the simulator.` |
| Ask for verification | `/howitworks Confirm every default and timeout against the config files, and list anything you couldn't confirm.` |

Three things that help in any prompt:

- **Name the main path**: "a trade order", "an ingest job", "a login". Otherwise Claude picks one.
- **Name the branches you want to see**: cache hit, retry, auth failure, empty result.
- **Mention what is outside the code**: dependency injection wiring, queues, other services. Static analysis cannot see these, but Claude adds them when you point at them.

What the skill does, in order:

1. Runs `scan` to collect facts about the repo into `.howitworks/`.
2. Reads the entry points and most-imported files, then follows the main path through the code.
3. Writes `.howitworks/architecture.json`: components, layers, connections, tours and where-to-change.
4. Adds the live simulator, reading every file on the main path in full.
5. Runs `render`, fixes every warning, and opens the page.

---

## Using the command line

### Commands

| Command | What it does | Uses Claude Code |
|---|---|---|
| `howitworks [repo]` | Full run: scan, describe, write the simulator, check, render | Yes |
| `howitworks scan [repo]` | Write `.howitworks/prompt.md`, `facts.md` and `schema.md` to paste into any Claude | No |
| `howitworks render [repo] --spec FILE [--scenario FILE]` | Check a description and draw the page | No |
| `howitworks simulate [repo] --spec FILE` | Add a live simulator to an existing description | Yes |
| `howitworks map [repo]` | Write `REPO_MAP.md`: structure only, no Claude | No |

`[repo]` is a local folder (default: the current folder) or a Git URL.

### Options

| Option | Meaning |
|---|---|
| `-o, --out DIR` | Where to write files. Default: current folder. |
| `--spec FILE` | The description to render, instead of generating one. |
| `--scenario FILE` | A live simulator to merge into the description when rendering. |
| `--name NAME` | Display name for the page. Default: the folder or repo name. |
| `--model NAME` | Model for Claude Code to use, such as `opus` or `sonnet`. Default: your Claude Code default. |
| `--no-sim` | Skip generating the live simulator. |
| `--open` | Open the page in your browser when done. |
| `--bare` | Write the page body only, for hosts that add their own `<html>` shell. |
| `-h, --help` | Show help. |

### Examples

```bash
# Whole repo, open the result
howitworks . --open

# A GitHub repo, results into docs/
howitworks https://github.com/pallets/flask.git -o docs --open

# Diagram only, no simulator
howitworks . --no-sim

# Use a different model
howitworks . --model sonnet
```

### Without Claude Code

Paste the prompt into any Claude (the Claude app, claude.ai) to do the writing, and use the CLI for everything else:

```bash
# 1. Write the prompt
howitworks scan .
#    -> .howitworks/prompt.md

# 2. Paste .howitworks/prompt.md into Claude and save its JSON reply as architecture.json

# 3. Draw the page
howitworks render . --spec architecture.json --open

# 4. Add the live simulator
howitworks simulate . --spec architecture.json
#    -> .howitworks/scenario-prompt.md: paste into Claude, save the reply as scenario.json
howitworks render . --spec architecture.json --scenario scenario.json --open
```

### Editing and re-rendering

Open `architecture.json`, change any label, description, connection or step, then:

```bash
howitworks render . --spec architecture.json --open
```

`render` checks the description before drawing it:

- Every file path must exist in the repo. Paths that do not are dropped and reported.
- Every connection and step must point at a known component.
- Every combination of simulator options is played from start to finish. Any combination that ends early or reaches an unknown component is reported by name.

Each problem is printed as a line starting with `warning:`. A clean description renders with no warnings.

---

## The interactive page

| Area | What you can do |
|---|---|
| **Send a call** bar | Pick options, edit the input (for example a URL or a topic and key), choose a speed, press **Send call**. Changing any option sends a new call. |
| **Diagram** | Click a box for its description, files, connections and related tasks. Arrows light up as a call travels: blue going in, green for responses, red for failures. |
| **Live call** panel | The current step and what happens there, the payload at that point, and the event log with simulated timing. |
| **Guided tours** | Numbered walkthroughs of the main paths. Step through them with Next and Previous. |
| **Where to make a change** | Common engineering tasks, each linked to the components involved. |
| **Give this to an AI assistant** | Copies the whole explanation as Markdown. |

The page works in light and dark mode, on desktop and phone, and needs no server.

---

## How it works

```
 repo ──> 1. Scan ──> 2. Describe ──> 3. Simulate ──> 4. Check ──> 5. Render
          imports,     components,     options and     file paths,   architecture.html
          entry        layers, tours   steps from      connections,  ARCHITECTURE.md
          points,      (Claude)        full source     every combo
          docs                         (Claude)
```

1. **Scan** (no AI). Reads every source file: imports and includes, packages, build files, the README, doc comments, entry points and HTTP routes. Builds the import graph, finds the most-imported files and import cycles, and groups files into packages. Test files, examples, documentation and vendored dependencies are left out.
2. **Describe.** Claude reads those facts plus the key files and writes the architecture: components, layers, connections, guided tours, and where to make changes.
3. **Simulate.** Claude reads the full source of every file on the main path and writes the simulator: the options the code really branches on, and the steps for every combination.
4. **Check** (no AI). Validates every file path, connection and step, and plays every simulator combination.
5. **Render** (no AI). Writes a single self-contained HTML page and the Markdown version.

In the skill, Claude does steps 2 and 3 directly. On the command line, the tool hands steps 2 and 3 to Claude Code in headless mode (`claude -p`), limited to reading and searching files in the repo. Either way, Claude can open as many files as it needs.

---

## Language support

| Language | Files | Dependencies found from | Other facts |
|---|---|---|---|
| Python | `.py` | `import`, `from ... import`, including relative imports. Imports inside `if TYPE_CHECKING:` are skipped. | Module and class docstrings, `__all__`, `if __name__ == "__main__"`, Flask, FastAPI and Django routes |
| Java | `.java` | `import` statements, wildcard imports, same-package references | Javadoc, `main`, Spring `@SpringBootApplication`, `@RestController` and `@GetMapping`-style routes |
| Kotlin | `.kt`, `.kts` | `import` statements, top-level functions, same-package references | KDoc, `fun main` |
| Scala | `.scala` | `import a.b.{C, D}`, wildcard imports | Scaladoc, `main` |
| TypeScript, JavaScript | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` | `import`, `export ... from`, `require()`, dynamic `import()`, `tsconfig` path aliases, monorepo workspace packages. Type-only imports are skipped. | JSDoc, exports, Express-style routes |
| C, C++ | `.c`, `.cc`, `.cpp`, `.cxx`, `.h`, `.hpp`, `.hh`, `.hxx`, `.ipp`, `.inl`, `.cu` | `#include "..."` and `#include <...>`, resolved relative to the including file first, then by matching the path against repo files. No build system needed. | File and class comments, `main()`, Crow routes |

**Build files read for dependencies:** `package.json`, `requirements.txt`, `pyproject.toml`, `pom.xml`, `build.gradle(.kts)`, `gradle/libs.versions.toml`, `CMakeLists.txt` (`find_package`), `vcpkg.json`, `conanfile.txt`.

**Left out of the scan:** `test`/`tests`/`spec` folders and test files (`test_*.py`, `*_test.py`, `*.test.ts`, `*.spec.js`, `*Test.java`, `*_test.cc`, `*_unittest.cc`), `examples`, `samples`, `docs` and `benchmarks` near the top of the repo, build output (`dist`, `build`, `target`, `out`), and vendored code (`node_modules`, `vendor`, `third_party`, `3rdparty`, `thirdparty`, `deps`, `extern`, `subprojects`).

---

## The description format

`architecture.json` is plain JSON. You can write or edit it by hand.

```json
{
  "name": "My Service",
  "summary": "Two or three sentences on what it is for and how it works.",
  "groups": [
    {"id": "api", "label": "Public API", "description": "One sentence."}
  ],
  "nodes": [
    {"id": "router", "group": "api", "kind": "core", "label": "Request router",
     "description": "One or two sentences on what it does and why.",
     "files": ["src/router.ts"]}
  ],
  "edges": [
    {"from": "router", "to": "auth", "label": "checks token"}
  ],
  "flows": [
    {"id": "request", "title": "Handle a request",
     "steps": [{"node": "router", "text": "What happens here, in one sentence."}]}
  ],
  "changes": [
    {"task": "Add a new endpoint", "nodes": ["router"]}
  ]
}
```

| Field | Meaning |
|---|---|
| `groups` | Horizontal layers, listed top to bottom. |
| `nodes[].kind` | `core` (a component), `step` (a pipeline stage that runs in order; keep them in one group, in order), `store` (holds state: cache, pool, queue), `external` (outside the repo), `addon` (optional module). |
| `nodes[].files` | Paths relative to the repo root. Checked on render. |
| `edges` | From the caller to the thing it uses. Labels are optional. |
| `flows` | Guided tours: an ordered list of `{node, text}` steps. |
| `changes` | Tasks mapped to the components where the change would go. |

### The simulator (`scenario`)

Add a `scenario` key to the same file:

```json
"scenario": {
  "title": "Send a request",
  "eventsLabel": "Code path (simulated timing)",
  "input": {"label": "URL", "value": "https://api.example.com/users/42"},
  "options": [
    {"id": "cache", "label": "Cache", "choices": [
      {"value": "miss", "label": "Nothing cached"},
      {"value": "hit", "label": "Fresh copy"}]},
    {"id": "server", "label": "Server", "enabledWhen": {"cache": "miss"}, "choices": [
      {"value": "ok", "label": "200 OK"},
      {"value": "error", "label": "500 error"}]}
  ],
  "steps": [
    {"node": "router", "text": "The request for {path} arrives.", "events": ["Router.handle()"]},
    {"node": "cache", "text": "Found in cache, returned at once.", "when": {"cache": "hit"}, "dir": "up"},
    {"node": "db", "text": "Loaded from the database.", "when": {"cache": "miss", "server": "ok"}, "ms": 12,
     "show": "SELECT * FROM users WHERE id = 42"}
  ]
}
```

| Field | Meaning |
|---|---|
| `input` | The text box above the diagram. URLs fill `{url}`, `{host}`, `{path}` and `{scheme}`. Add `pattern`, a regular expression with named groups, to define your own placeholders, for example `"^(?<topic>\\S+) key=(?<key>\\S+)"`. |
| `options` | Choices the viewer picks. The first choice of each option should be the normal case. |
| `options[].enabledWhen` | Disables an option unless other options match, for example `{"cache": "miss"}`. |
| `options[].choices[].vars` | Extra placeholders this choice sets. A step's `node` may use one, such as `"{protoNode}"`. |
| `derive` | Computed values, evaluated in order: `{"id": "isrOk", "value": "no", "when": {...}}`. Steps can test them like options. |
| `steps[].when` | The step runs only if every key matches. A list means any of those values. Steps without `when` always run. |
| `steps[].dir` | `down` going in (default), `up` for responses, `fail` for errors. |
| `steps[].events` | Lines added to the event log. Use real function or method names from the code. |
| `steps[].ms` | Simulated time spent at this step. Illustrative. |
| `steps[].show` | The payload at this point: a request, a SQL query, a record, a response. |
| `steps[].quiet` | Animate through this step without narrating it. |

Write the steps so that every combination of options plays a complete path from the caller and back. `render` plays all of them and tells you which ones don't.

Complete, checked examples are in [`skills/howitworks/examples/`](skills/howitworks/examples/):

| Example | Repo | Simulator |
|---|---|---|
| `okhttp.architecture.json` | [square/okhttp](https://github.com/square/okhttp) | An HTTP call: cache, connection reuse, HTTP/2 or 1.1, redirects, auth, dropped connections |
| `kafka.architecture.json` | [apache/kafka](https://github.com/apache/kafka) | Producing a record: acks, batching, metadata, a moved leader, too few in-sync replicas, idempotent retries |
| `petclinic.architecture.json` | [spring-projects/spring-petclinic](https://github.com/spring-projects/spring-petclinic) | Finding owners, adding a pet with validation errors, a cached vets list |

---

## Keeping it up to date

Regenerate after structural changes, or on a schedule. A nightly GitLab CI job:

```yaml
howitworks:
  image: node:20-slim
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - apt-get update -qq && apt-get install -yqq git > /dev/null
    - npm install -g @anthropic-ai/claude-code
    - npx github:koppulapr2230/howitworks . -o docs/architecture
    - git add docs/architecture
    - git diff --cached --quiet || (git -c user.name="howitworks" -c user.email="ci@example.com" commit -m "Update architecture diagram" && git push "https://oauth2:${HOWITWORKS_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git" HEAD:$CI_DEFAULT_BRANCH)
```

Claude Code needs a login on the runner: run `claude setup-token` on your machine and save the token as a masked CI/CD variable named `CLAUDE_CODE_OAUTH_TOKEN`. Also add `HOWITWORKS_TOKEN`, a project access token with write access.

To have AI assistants use the result, add a line to `CLAUDE.md` or `AGENTS.md`, for example: *Read docs/architecture/ARCHITECTURE.md before exploring the code.*

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/howitworks` does not appear in Claude Code | Start a new session. On Claude Code v2.1.152 or later you can run `/reload-skills` instead. Check that `~/.claude/skills/howitworks/SKILL.md` exists. |
| `/reload-skills` is not available | Your Claude Code is older than v2.1.152. Run `claude update`, or restart the session. |
| The skill is installed but missing in a cloud or Cowork session | Skills in `~/.claude/skills` load only in Claude Code on that machine. Upload the ZIP in the Claude app instead. |
| `No imports between source files were found` | The repo is not in a supported language, or the scan skipped everything as tests, examples or vendored code. |
| `Claude Code is not installed` | Install it from [code.claude.com](https://code.claude.com/docs/en/setup) and run `claude` once to log in. Or use `scan` and `render` without it. |
| `Claude Code: ... login` or `Not logged in` | Run `claude` in a terminal and log in, then try again. |
| `git clone failed` | Check the URL and your access, or clone the repo yourself and pass the folder. |
| Lines starting with `warning:` | Each names something to fix in `architecture.json`: a missing file, an unknown component, or a simulator combination that does not finish. |
| A component description is wrong | Edit `architecture.json` and run `render` again. |

---

## Limitations

- **Static analysis.** The scan sees imports and includes, not runtime wiring: dependency injection, reflection, function pointers, virtual dispatch, config-driven plugins and calls between services are not detected. Claude describes them when it finds them in the code or when you mention them.
- **The simulator is a model of the code, not a trace.** Paths, class names and events come from the source; timings, IDs and payload values are illustrative.
- **Descriptions are only as accurate as what Claude reads.** File paths and simulator paths are checked mechanically; prose is not. Review the first result before committing it.
- **Very large repos.** The command line sends a bounded amount of source to Claude. For large monorepos, use the skill (which explores as needed) or focus on one part of the repo.

---

## Project layout

```
howitworks/
├── package.json                  npm package "howitworks-cli", command "howitworks"
├── README.md
├── LICENSE
└── skills/howitworks/            the skill (also what npm installs)
    ├── SKILL.md                  instructions Claude follows
    ├── scripts/
    │   ├── cli.mjs               command line entry point
    │   └── lib/
    │       ├── scan.mjs          file discovery and import resolution per language
    │       ├── analyze.mjs       import graph, cycles, packages
    │       ├── facts.mjs         README, doc comments, entry points, routes, dependencies
    │       └── arch.mjs          prompts, Claude Code runner, validation, Markdown and HTML output
    ├── templates/
    │   └── architecture.html     the interactive page
    └── examples/                 OkHttp, Kafka and PetClinic descriptions
```

To work on it locally:

```bash
git clone https://github.com/koppulapr2230/howitworks.git
cd howitworks
node skills/howitworks/scripts/cli.mjs --help
node skills/howitworks/scripts/cli.mjs map /path/to/some/repo
```

---

## Publishing

**npm** (makes `npx howitworks-cli` work for everyone):

```bash
npm login
npm publish
```

To publish under your own scope instead, set `"name": "@<your-npm-user>/howitworks"` in `package.json` and run `npm publish --access public`. The command becomes `npx @<your-npm-user>/howitworks`.

**Skill installs** use this GitHub repo directly: `npx skills add koppulapr2230/howitworks` always installs the latest commit on `main`.

---

## License

MIT. See [LICENSE](LICENSE).
