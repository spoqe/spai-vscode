# spai for VSCode

Right-click code analysis tools for any codebase.

## Commands

### On files (Explorer > right-click)

- **Who Imports This?** — reverse dependencies
- **Co-Change Partners** — files that move together in git history
- **File Biography** — creation, growth phases, refactors, stabilization

### On folders (Explorer > right-click)

- **Architecture Drift** — where implicit coupling diverges from explicit imports
- **Module Shape** — all functions, types, impls grouped by file

### On symbols (Editor > right-click)

- **Blast Radius** — definition, callers, tests, risk assessment, git authors

## Requirements

- `spai` CLI (typically at `~/.local/bin/spai`)

## Settings

| Setting | Default | Description |
|---|---|---|
| `spai.binaryPath` | (PATH) | Path to spai binary |
| `spai.timeout` | `30000` | Timeout for commands (ms) |
