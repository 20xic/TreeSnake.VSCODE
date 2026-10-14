import * as vscode from 'vscode';
import { parseGitignore } from './core/gitignore';
import { OutputFormat } from './core/formatters';
import { CompiledRules, ScanConfig } from './core/rules';
import { EntryType, FileSystem } from './core/scanner';

const SECTION = 'treesnake';

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}

export function defaultFormat(): OutputFormat {
  return vscode.workspace.getConfiguration(SECTION).get<OutputFormat>('defaultFormat', 'llm');
}

/** Настройки + `.gitignore` корня workspace-папки (аддитивно, как apply_gitignore у CLI). */
export async function loadRules(folder: vscode.WorkspaceFolder): Promise<CompiledRules> {
  const settings = vscode.workspace.getConfiguration(SECTION, folder.uri);
  const config: ScanConfig = {
    excludeDirs: settings.get<string[]>('excludeDirs', []),
    excludeFiles: settings.get<string[]>('excludeFiles', []),
    excludeContentFiles: settings.get<string[]>('excludeContentFiles', []),
    maxFileSize: settings.get<number | null>('maxFileSize', null),
  };

  if (settings.get<boolean>('useGitignore', true)) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, '.gitignore'));
      const patterns = parseGitignore(new TextDecoder().decode(bytes));
      config.excludeDirs = dedupe([...config.excludeDirs, ...patterns.dirs]);
      config.excludeFiles = dedupe([...config.excludeFiles, ...patterns.files]);
    } catch {
      // нет .gitignore — ничего не добавляем
    }
  }
  return new CompiledRules(config);
}

function entryType(type: vscode.FileType): EntryType {
  // Симлинк приходит как File|SymbolicLink — смотрим на базовый тип.
  if (type & vscode.FileType.Directory) return 'directory';
  if (type & vscode.FileType.File) return 'file';
  return 'other';
}

/** FileSystem для сканера поверх vscode.workspace.fs; пути — `uri.path` внутри `base`. */
export function workspaceFs(base: vscode.Uri): FileSystem {
  const toUri = (path: string) => base.with({ path });
  return {
    async readDirectory(path) {
      const entries = await vscode.workspace.fs.readDirectory(toUri(path));
      return entries.map(([name, type]) => [name, entryType(type)]);
    },
    async stat(path) {
      const stat = await vscode.workspace.fs.stat(toUri(path));
      return { type: entryType(stat.type), size: stat.size };
    },
    readFile: (path) => Promise.resolve(vscode.workspace.fs.readFile(toUri(path))),
  };
}
