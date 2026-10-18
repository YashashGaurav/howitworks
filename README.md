# howitworks

Draws how a repository works: an interactive diagram of its main parts and how they connect, step-by-step walkthroughs of the important paths, and a live simulator that plays a request through the code. The same content is written to `ARCHITECTURE.md` for engineers and AI assistants.

Works on Python, Java, Kotlin, Scala, TypeScript, JavaScript, C and C++ repos. Node 18 or newer, no dependencies.

The npm package is `howitworks-cli` (the name `howitworks` is taken on npm); the command it installs is `howitworks`.

## Install as an agent skill (recommended)

```bash
npx skills add koppulapr2230/howitworks -g
```

Then, in Claude Code or another agent, ask: "Draw the architecture of this repo." The agent scans the repo, reads the code, writes the description, and renders `architecture.html`. No API key needed: the agent does the reading.

## Run with npx

```bash
# One step, using the Claude API
export ANTHROPIC_API_KEY=sk-ant-...
npx howitworks-cli /path/to/repo --open
npx howitworks-cli https://github.com/org/repo.git --open

# Without an API key: write a prompt, have any Claude describe the repo, then render
npx howitworks-cli scan /path/to/repo
#   give .howitworks/prompt.md to Claude, save the JSON reply as architecture.json
npx howitworks-cli render /path/to/repo --spec architecture.json --open
```

| Command | What it does |
|---|---|
| `howitworks [repo]` | Scan, generate the description and the live simulator with Claude, render. |
| `howitworks simulate [repo] --spec FILE` | Add a live simulator to an existing description. |
| `howitworks scan [repo]` | Write `.howitworks/prompt.md`, `facts.md` and `schema.md`. |
| `howitworks render [repo] --spec FILE [--scenario FILE]` | Validate a description and render it. Every file path is checked, and every combination of simulator options is played to make sure it completes. |
| `howitworks map [repo]` | Write `REPO_MAP.md`, the structural facts only. |

Options: `-o DIR`, `--name`, `--model` (default `claude-opus-5-5`), `--no-sim`, `--open`, `--bare`.

Output: `architecture.html`, `ARCHITECTURE.md`, and `architecture.json` (edit it and re-render with `--spec`).

## Examples

`skills/howitworks/examples/` has checked descriptions of OkHttp, Apache Kafka and Spring PetClinic, all with live simulators. PetClinic's was produced by following the skill on a fresh clone:

```bash
git clone --depth 1 https://github.com/apache/kafka.git
npx howitworks-cli render kafka --spec skills/howitworks/examples/kafka.architecture.json --open
```

## How it works

1. **Scan.** Reads imports (Python, Java, Kotlin, Scala, TS/JS, and `#include` for C/C++), packages, build files (including CMake, vcpkg and Conan), README and doc comments, entry points and HTTP routes, and finds the most-imported files and import cycles. C/C++ includes are resolved without the build system: relative to the including file first, then by matching the path against repo files.
2. **Describe.** An agent or the Claude API reads the facts and the key files and writes `architecture.json`: components, layers, connections and walkthroughs.
3. **Simulate.** A second pass reads the full source of every file on the main path and writes the live simulator: the options the code branches on, and every step for every combination.
4. **Render.** Checks every file path against the repo, plays every combination of simulator options to confirm each one completes, and writes a single self-contained HTML page.

## Limits

Static analysis only. Dependency-injection wiring, reflection, config-driven behavior and calls between services are not detected, though the agent can describe them if it finds them in the code. Live simulators are written by the agent from the code; the timings in them are illustrative.

## Publishing

```bash
npm publish            # makes `npx howitworks-cli` work for everyone
git push               # makes `npx skills add koppulapr2230/howitworks` work
```
