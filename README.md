# spai (say spy) — Code Analysis for VSCode

Right-click code analysis. No indexing step, no language server, no configuration. Works on any codebase with git history.

Made by Claude, for Claude, with the humans at [Semantic Partners](https://semanticpartners.com). So the human can see what we see.

**What it does:** Answers the questions you ask before changing code — who calls this? what breaks if I change it? what files move together? how did this module get here?

![Overview](screenshots/overview.png)
<!-- Screenshot: editor right-click menu showing spai commands -->

## Installation

### 1. Install spai CLI

```bash
curl -fsSL https://raw.githubusercontent.com/Semantic-partners/spai/main/install.sh | bash
```

Or manually: clone the repo and add `~/.local/bin/spai` to your PATH.

**Dependencies:** [babashka](https://github.com/babashka/babashka) (`bb`) and [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`).

### 2. Install the extension

Search **"spai"** in the VSCode Extensions panel, or:

```
ext install spoqe.spai
```

That's it. No project configuration needed.

## How to Find It

Everything is in **right-click context menus**. Also available in the command palette (`Cmd+Shift+P` → "spai:") if you prefer.

| You want to... | Right-click on... | Command |
|---|---|---|
| See who calls a function | A symbol in the editor | **Blast Radius** |
| See where a symbol is used | A symbol in the editor | **Symbol Context** |
| Find reverse dependencies | A file (editor or explorer) | **Who Imports This?** |
| Find files that change together | A file (editor or explorer) | **Co-Change Partners** |
| Read a file's history narrative | A file (editor or explorer) | **File Biography** |
| See module structure | A folder in the explorer | **Module Shape** |
| Find change hotspots | A folder in the explorer | **Hotspots** |
| Find architectural drift | A folder in the explorer | **Architecture Drift** |
| Find TODOs/FIXMEs | A folder in the explorer | **TODOs** |

## Commands

### Blast Radius

*Right-click a symbol in the editor*

Who defines it, who calls it, what tests cover it, who last touched it, and a risk assessment. Everything you need before renaming, deleting, or changing a function's signature.

![Blast Radius](screenshots/blast-radius.png)
<!-- Screenshot: blast radius panel showing definition, callers, tests, git authors -->

---

### Symbol Context

*Right-click a symbol in the editor*

Every usage of a symbol, shown with the **enclosing function name** — not just line numbers, but *which functions* call it. Understand how a function is used across the codebase.

![Symbol Context](screenshots/symbol-context.png)
<!-- Screenshot: symbol context panel showing usages grouped by enclosing function -->

---

### Who Imports This?

*Right-click a file in the editor or explorer*

Reverse dependency lookup. Before you edit a file, see every file that imports it. Understand downstream impact in one click.

![Who Imports This?](screenshots/who.png)
<!-- Screenshot: who-imports panel showing list of importing files -->

---

### Co-Change Partners

*Right-click a file in the editor or explorer*

Files that move together in git history. If file A changes, which other files usually change with it? Reveals implicit coupling that imports don't show — the hidden dependencies that bite you during refactors.

![Co-Change Partners](screenshots/related.png)
<!-- Screenshot: co-change panel showing files with percentage correlation -->

---

### File Biography

*Right-click a file in the editor or explorer*

The story of a file: when it was created, its growth phases, major refactors, stabilization periods. Understand how code got to its current state before you change it.

![File Biography](screenshots/narrative.png)
<!-- Screenshot: file biography panel showing timeline of file evolution -->

---

### Module Shape

*Right-click a folder in the explorer*

All functions, types, and implementations in a directory, grouped by file. Clickable — click any symbol to jump to its definition. The API surface of a module at a glance.

![Module Shape](screenshots/shape.png)
<!-- Screenshot: module shape panel showing functions/types/impls grouped by file, with clickable symbols -->

---

### Hotspots

*Right-click a folder in the explorer*

Files ranked by change frequency. A treemap visualization shows where development effort concentrates — the files that get touched most often. Click any cell to open the file.

Tabs: **Chart** (treemap) | **List** (ranked table)

![Hotspots Chart](screenshots/hotspots-chart.png)
<!-- Screenshot: hotspots treemap visualization with colored cells -->

![Hotspots List](screenshots/hotspots-list.png)
<!-- Screenshot: hotspots list view showing files ranked by commits/lines changed -->

---

### Architecture Drift

*Right-click a folder in the explorer*

Where implicit coupling (co-change in git) diverges from explicit coupling (imports). Finds files that *should* be in the same module but aren't, or files in the same module that never change together. Architecture debt, surfaced.

![Architecture Drift](screenshots/drift.png)
<!-- Screenshot: drift panel showing coupling mismatches -->

---

### TODOs

*Right-click a folder in the explorer*

Every TODO, FIXME, HACK, and XXX in a directory, with file locations. Click to jump to the line.

![TODOs](screenshots/todos.png)
<!-- Screenshot: TODOs panel showing categorized TODO/FIXME/HACK items with file links -->

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `spai.binaryPath` | *(searches PATH)* | Path to the spai binary. Leave empty to auto-detect (`~/.local/bin/spai`). |
| `spai.timeout` | `30000` | Timeout for commands in milliseconds. Git-heavy commands (biography, co-change, drift) can be slow on large repos. |

## How It Works

spai analyzes your codebase using three sources:

1. **ripgrep** — fast code search for symbols, imports, definitions
2. **git log** — commit history for co-change analysis, hotspots, file biographies
3. **tree-sitter patterns** — language-aware function/type extraction

No background indexing. No language server. Each command runs on demand and returns results in seconds. Works on Rust, TypeScript, Python, Go, Java, Ruby, C/C++, Clojure, and more.

## Troubleshooting

**"spai not found"** — Make sure `spai` is on your PATH, or set `spai.binaryPath` in settings. Test with `spai help` in your terminal.

**Slow results** — Git-based commands (biography, co-change, drift, hotspots) run `git log`, which can be slow on repos with long history. Increase `spai.timeout` if needed.

**No results for a language** — spai uses regex patterns for code structure. If your language isn't supported, [open an issue](https://github.com/Semantic-partners/spai/issues).

## License

MIT
