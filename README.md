# TreeSnake for VS Code

Pick files and folders in your workspace and export them — structure and contents — as
LLM-ready text or XML, to the clipboard or a file. The VS Code companion to the
[`treesnake`](https://github.com/20xic/TreeSnake) CLI; the output is the same as
`treesnake scan --fmt llm|xml`.

## Usage

**TreeSnake view** (snake icon in the activity bar):

- Tick files or folders. Ticking a folder selects everything inside it, including files
  created later; untick individual children to carve them out. Folders with a mixed
  selection are marked *partially selected*.
- Toolbar: **Copy as LLM**, **Copy as XML**, **Save to File...**, **Refresh**;
  `...` menu: **Select All**, **Clear Selection**.
- The selection is remembered per workspace.

**Explorer context menu → TreeSnake**: *Copy as LLM*, *Copy as XML*, *Save to File...* for
the right-clicked (or multi-selected) items without touching the view's selection, and
*Add to Selection*.

After copying, a notification shows the file count and a rough token estimate
(~4 chars/token).

## Formats

**LLM** — every file under a `# path` header, separated by `---`:

```
# myapp/main.py
print("hello")
---
# myapp/core/scanner.py
...
---
```

**XML** — nested `<project>/<directory>/<file>`, each file carries its full `path`,
content kept verbatim in CDATA:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project name="myapp">
  <file name="main.py" path="myapp/main.py" size="42"><![CDATA[
print("hello")
]]></file>
</project>
```

In a multi-root workspace each folder is its own `<project>`, wrapped in `<workspace>`.

## Settings

| Setting | Default | |
|---|---|---|
| `treesnake.excludeDirs` | `.git`, `node_modules`, `venv`, … | Hidden in the view and skipped in output |
| `treesnake.excludeFiles` | `*.pyc`, `*.exe`, `*.dll`, … | Same, for files |
| `treesnake.excludeContentFiles` | `*.lock`, `package-lock.json`, `*.log` | Listed, but without content |
| `treesnake.useGitignore` | `true` | Merge the workspace folder's root `.gitignore` |
| `treesnake.maxFileSize` | `1048576` | Larger files get `[File too large: N bytes]`; `null` = no limit |
| `treesnake.defaultFormat` | `llm` | Pre-selected format in **Save to File...** |

Patterns match the bare name at every level, as in the CLI: exact (`.git`), glob (`*.pyc`)
or regex (`re:^\..*`). Only the gitignore subset the CLI supports is used — no negations,
no patterns with an inner `/`. Binary files (NUL in the first 8 KiB) and non-UTF-8 files
show up as `[Content could not be read]`.

## Development

```bash
npm install
npm test          # compile + unit tests (node:test, no VS Code needed)
npm run watch     # then F5 → "Run Extension"
npm run package   # build treesnake-X.Y.Z.vsix
```

`src/core/` is a VS Code–independent port of the CLI's rules, gitignore parser and
formatters; `src/extension.ts`, `src/fileTree.ts` and `src/config.ts` are the VS Code layer.
