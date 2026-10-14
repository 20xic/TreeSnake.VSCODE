import * as vscode from 'vscode';
import { loadRules } from './config';
import { CompiledRules } from './core/rules';
import { SelectionState } from './core/selection';

const STATE_KEY = 'treesnake.selection';

export interface FileNode {
  folder: vscode.WorkspaceFolder;
  /** Путь от корня workspace-папки через `/`; '' — сам корень. */
  rel: string;
  isDirectory: boolean;
}

/** Дерево файлов воркспейса с чекбоксами; скрывает то, что исключено правилами. */
export class FileTreeProvider implements vscode.TreeDataProvider<FileNode> {
  private readonly changed = new vscode.EventEmitter<FileNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private readonly selections = new Map<string, SelectionState>();
  private readonly rules = new Map<string, Promise<CompiledRules>>();

  constructor(private readonly memento: vscode.Memento) {
    const saved = memento.get<Record<string, unknown>>(STATE_KEY, {});
    for (const [key, data] of Object.entries(saved)) {
      this.selections.set(key, SelectionState.fromJSON(data));
    }
  }

  refresh(): void {
    this.rules.clear();
    this.changed.fire(undefined);
  }

  selectionFor(folder: vscode.WorkspaceFolder): SelectionState {
    const key = folder.uri.toString();
    let state = this.selections.get(key);
    if (!state) {
      state = new SelectionState();
      this.selections.set(key, state);
    }
    return state;
  }

  rulesFor(folder: vscode.WorkspaceFolder): Promise<CompiledRules> {
    const key = folder.uri.toString();
    let rules = this.rules.get(key);
    if (!rules) {
      rules = loadRules(folder);
      this.rules.set(key, rules);
    }
    return rules;
  }

  get hasSelection(): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((f) => !this.selectionFor(f).isEmpty);
  }

  setChecked(changes: readonly (readonly [FileNode, boolean])[]): void {
    for (const [node, checked] of changes) this.selectionFor(node.folder).set(node.rel, checked);
    this.persistAndRender();
  }

  selectAll(checked: boolean): void {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const state = this.selectionFor(folder);
      state.clear();
      if (checked) state.set('', true);
    }
    this.persistAndRender();
  }

  private persistAndRender(): void {
    const data: Record<string, unknown> = {};
    for (const [key, state] of this.selections) {
      if (!state.isEmpty) data[key] = state.toJSON();
    }
    void this.memento.update(STATE_KEY, data);
    this.changed.fire(undefined);
  }

  getTreeItem(node: FileNode): vscode.TreeItem {
    const uri = vscode.Uri.joinPath(node.folder.uri, node.rel);
    const state = this.selectionFor(node.folder);
    // Метка берётся из resourceUri (имя файла + иконка темы), корень — по имени папки.
    const item = new vscode.TreeItem(
      uri,
      node.isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    if (node.rel === '') item.label = node.folder.name;
    item.id = `${node.folder.uri.toString()}#${node.rel}`;
    item.checkboxState = state.isSelected(node.rel)
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    if (node.isDirectory) {
      if (state.isPartial(node.rel)) item.description = 'partially selected';
    } else {
      item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
    }
    if (node.rel === '') item.iconPath = new vscode.ThemeIcon('root-folder');
    return item;
  }

  async getChildren(node?: FileNode): Promise<FileNode[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!node) {
      if (folders.length === 1) return this.listDir({ folder: folders[0], rel: '', isDirectory: true });
      return folders.map((folder) => ({ folder, rel: '', isDirectory: true }));
    }
    return this.listDir(node);
  }

  private async listDir(node: FileNode): Promise<FileNode[]> {
    const rules = await this.rulesFor(node.folder);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(node.folder.uri, node.rel));
    } catch {
      return [];
    }
    const nodes: FileNode[] = [];
    for (const [name, type] of entries) {
      const isDirectory = (type & vscode.FileType.Directory) !== 0;
      const isFile = (type & vscode.FileType.File) !== 0;
      if (isDirectory ? rules.excludeDirs.matches(name) : !isFile || rules.excludeFiles.matches(name)) {
        continue;
      }
      nodes.push({ folder: node.folder, rel: node.rel ? `${node.rel}/${name}` : name, isDirectory });
    }
    // Папки сверху, дальше по имени — как в Explorer.
    return nodes.sort((a, b) =>
      a.isDirectory !== b.isDirectory
        ? a.isDirectory ? -1 : 1
        : a.rel.localeCompare(b.rel, undefined, { sensitivity: 'base' }),
    );
  }
}
