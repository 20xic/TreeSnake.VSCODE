import * as vscode from 'vscode';
import { defaultFormat, workspaceFs } from './config';
import { FILE_EXTENSIONS, OutputFormat, getFormatter } from './core/formatters';
import { Directory, countFiles } from './core/models';
import { Scanner, Selection } from './core/scanner';
import { SelectionState } from './core/selection';
import { FileTreeProvider } from './fileTree';

type SelectionFor = (folder: vscode.WorkspaceFolder) => Selection;

/** Сканирует выбранное во всех workspace-папках; корень каждой — под её именем. */
async function collect(provider: FileTreeProvider, selectionFor: SelectionFor): Promise<Directory[]> {
  const roots: Directory[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const scanner = new Scanner(workspaceFs(folder.uri), await provider.rulesFor(folder));
    const root = await scanner.scan(folder.uri.path, folder.name, selectionFor(folder));
    if (root) roots.push(root);
  }
  return roots;
}

async function render(
  provider: FileTreeProvider,
  selectionFor: SelectionFor,
  format: OutputFormat,
): Promise<{ text: string; files: number } | undefined> {
  const roots = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'TreeSnake: scanning…' },
    () => collect(provider, selectionFor),
  );
  const files = roots.reduce((sum, root) => sum + countFiles(root), 0);
  if (!roots.length) {
    vscode.window.showWarningMessage('TreeSnake: nothing selected (or everything is excluded).');
    return undefined;
  }
  return { text: getFormatter(format).format(roots), files };
}

function summary(files: number, text: string): string {
  // Грубая оценка: ~4 символа на токен.
  const tokens = Math.round(text.length / 4).toLocaleString('en-US');
  return `${files} file${files === 1 ? '' : 's'}, ~${tokens} tokens`;
}

async function copy(provider: FileTreeProvider, selectionFor: SelectionFor, format: OutputFormat) {
  const result = await render(provider, selectionFor, format);
  if (!result) return;
  await vscode.env.clipboard.writeText(result.text);
  vscode.window.showInformationMessage(
    `TreeSnake: copied ${summary(result.files, result.text)} as ${format.toUpperCase()}.`,
  );
}

async function pickFormat(): Promise<OutputFormat | undefined> {
  const preferred = defaultFormat();
  const items: (vscode.QuickPickItem & { format: OutputFormat })[] = [
    { label: 'LLM', description: 'path headers + raw content, token-efficient', format: 'llm' },
    { label: 'XML', description: 'nested <project>/<directory>/<file>, content in CDATA', format: 'xml' },
  ];
  items.sort((a, b) => Number(b.format === preferred) - Number(a.format === preferred));
  return (await vscode.window.showQuickPick(items, { placeHolder: 'Output format' }))?.format;
}

async function save(provider: FileTreeProvider, selectionFor: SelectionFor) {
  const format = await pickFormat();
  if (!format) return;
  const base = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    defaultUri: base && vscode.Uri.joinPath(base, `context.${FILE_EXTENSIONS[format]}`),
    filters: { [format.toUpperCase()]: [FILE_EXTENSIONS[format]], 'All files': ['*'] },
  });
  if (!target) return;
  const result = await render(provider, selectionFor, format);
  if (!result) return;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(result.text));
  const open = await vscode.window.showInformationMessage(
    `TreeSnake: saved ${summary(result.files, result.text)} to ${vscode.workspace.asRelativePath(target)}.`,
    'Open',
  );
  if (open) await vscode.window.showTextDocument(target);
}

/** Выбор из контекстного меню Explorer: (uri, uris) -> отдельный SelectionState на папку. */
function explorerSelection(uri?: vscode.Uri, uris?: vscode.Uri[]): SelectionFor | undefined {
  const targets = uris?.length ? uris : uri ? [uri] : [];
  const states = new Map<string, SelectionState>();
  for (const target of targets) {
    const folder = vscode.workspace.getWorkspaceFolder(target);
    if (!folder) continue;
    const key = folder.uri.toString();
    if (!states.has(key)) states.set(key, new SelectionState());
    states.get(key)!.set(relativePath(folder, target), true);
  }
  if (!states.size) {
    vscode.window.showWarningMessage('TreeSnake: select files or folders inside the workspace.');
    return undefined;
  }
  const empty = new SelectionState();
  return (folder) => states.get(folder.uri.toString()) ?? empty;
}

function relativePath(folder: vscode.WorkspaceFolder, uri: vscode.Uri): string {
  const base = folder.uri.path.replace(/\/$/, '');
  return uri.path === base ? '' : uri.path.slice(base.length + 1);
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new FileTreeProvider(context.workspaceState);
  const view = vscode.window.createTreeView('treesnake.files', {
    treeDataProvider: provider,
    manageCheckboxStateManually: true,
    showCollapseAll: true,
  });

  const updateMessage = () => {
    view.message = provider.hasSelection ? undefined : 'Tick files or folders, then copy or save them.';
  };
  updateMessage();

  const fromView: SelectionFor = (folder) => provider.selectionFor(folder);

  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => provider.refresh(), 300);
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);

  context.subscriptions.push(
    view,
    watcher,
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.path.endsWith('/.gitignore')) scheduleRefresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('treesnake')) provider.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
    view.onDidChangeCheckboxState((e) => {
      provider.setChecked(
        e.items.map(([node, state]) => [node, state === vscode.TreeItemCheckboxState.Checked] as const),
      );
      updateMessage();
    }),

    vscode.commands.registerCommand('treesnake.copyLlm', () => copy(provider, fromView, 'llm')),
    vscode.commands.registerCommand('treesnake.copyXml', () => copy(provider, fromView, 'xml')),
    vscode.commands.registerCommand('treesnake.save', () => save(provider, fromView)),
    vscode.commands.registerCommand('treesnake.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('treesnake.selectAll', () => {
      provider.selectAll(true);
      updateMessage();
    }),
    vscode.commands.registerCommand('treesnake.clearSelection', () => {
      provider.selectAll(false);
      updateMessage();
    }),

    vscode.commands.registerCommand('treesnake.explorer.copyLlm', (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const selection = explorerSelection(uri, uris);
      if (selection) return copy(provider, selection, 'llm');
    }),
    vscode.commands.registerCommand('treesnake.explorer.copyXml', (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const selection = explorerSelection(uri, uris);
      if (selection) return copy(provider, selection, 'xml');
    }),
    vscode.commands.registerCommand('treesnake.explorer.save', (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const selection = explorerSelection(uri, uris);
      if (selection) return save(provider, selection);
    }),
    vscode.commands.registerCommand(
      'treesnake.explorer.addToSelection',
      (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        const targets = uris?.length ? uris : uri ? [uri] : [];
        const changes: [{ folder: vscode.WorkspaceFolder; rel: string; isDirectory: boolean }, boolean][] = [];
        for (const target of targets) {
          const folder = vscode.workspace.getWorkspaceFolder(target);
          if (folder) changes.push([{ folder, rel: relativePath(folder, target), isDirectory: false }, true]);
        }
        provider.setChecked(changes);
        updateMessage();
      },
    ),
  );
}

export function deactivate(): void {}
