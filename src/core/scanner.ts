// Сборка дерева Directory из выбранных путей. Аналог BaseScanner, но обходит
// не всю папку, а только то, что выбрал пользователь. ФС инжектится
// (vscode.workspace.fs в расширении, node:fs в тестах).

import { CompiledRules } from './rules';
import { Directory, File } from './models';

export type EntryType = 'file' | 'directory' | 'other';

export interface FileSystem {
  readDirectory(path: string): Promise<[string, EntryType][]>;
  stat(path: string): Promise<{ type: EntryType; size: number }>;
  readFile(path: string): Promise<Uint8Array>;
}

export interface Selection {
  /** Выбран ли путь целиком (rel — от корня через `/`, корень — ''). */
  isSelected(relPath: string): boolean;
  /** Есть ли внутри папки что-то выбранное — стоит ли в неё спускаться. */
  hasSelectedDescendants(relPath: string): boolean;
}

export const CONTENT_EXCLUDED = '';
export const CONTENT_UNREADABLE = '[Content could not be read]';
const BINARY_SNIFF_BYTES = 8192;

export function tooLargePlaceholder(size: number): string {
  return `[File too large: ${size} bytes]`;
}

export function joinPath(base: string, name: string): string {
  return base.endsWith('/') ? base + name : `${base}/${name}`;
}

/** Как FileReader у CLI: бинарник по NUL в первых 8 КиБ, строгий UTF-8, \r\n -> \n. */
export function decodeContent(bytes: Uint8Array): string {
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return CONTENT_UNREADABLE;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return CONTENT_UNREADABLE;
  }
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text;
}

export class Scanner {
  constructor(
    private readonly fs: FileSystem,
    private readonly rules: CompiledRules,
  ) {}

  /** Дерево выбранного под корнем `rootPath`; null — если там ничего не выбрано. */
  async scan(rootPath: string, rootName: string, selection: Selection): Promise<Directory | null> {
    const pending: Promise<void>[] = [];
    const root = await this.scanDir(rootPath, '', rootName, selection, pending);
    await Promise.all(pending);
    return root;
  }

  private async scanDir(
    absPath: string,
    relPath: string,
    name: string,
    selection: Selection,
    pending: Promise<void>[],
  ): Promise<Directory | null> {
    const selected = selection.isSelected(relPath);
    let entries: [string, EntryType][];
    try {
      entries = await this.fs.readDirectory(absPath);
    } catch {
      return selected ? { name, files: [], subdirectories: [] } : null;
    }
    // Сортировка по коду символа, как sorted() в Python.
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    const dir: Directory = { name, files: [], subdirectories: [] };
    const subdirs: Promise<Directory | null>[] = [];

    for (const [entryName, type] of entries) {
      const childAbs = joinPath(absPath, entryName);
      const childRel = relPath ? `${relPath}/${entryName}` : entryName;
      if (type === 'file') {
        if (this.rules.excludeFiles.matches(entryName)) continue;
        if (!selection.isSelected(childRel)) continue;
        const file: File = { name: entryName, content: '', size: 0 };
        dir.files.push(file);
        pending.push(this.fillFile(file, childAbs));
      } else if (type === 'directory') {
        if (this.rules.excludeDirs.matches(entryName)) continue;
        if (!selection.isSelected(childRel) && !selection.hasSelectedDescendants(childRel)) continue;
        subdirs.push(this.scanDir(childAbs, childRel, entryName, selection, pending));
      }
    }

    for (const sub of await Promise.all(subdirs)) {
      if (sub) dir.subdirectories.push(sub);
    }

    // Пустая папка попадает в вывод, только если выбрана сама
    // (как `# path/` у CLI); иначе — это просто путь к выбранному глубже.
    if (!dir.files.length && !dir.subdirectories.length && !selected) return null;
    return dir;
  }

  private async fillFile(file: File, absPath: string): Promise<void> {
    try {
      file.size = (await this.fs.stat(absPath)).size;
    } catch {
      file.content = CONTENT_UNREADABLE;
      return;
    }
    if (this.rules.excludeContentFiles.matches(file.name)) {
      file.content = CONTENT_EXCLUDED;
      return;
    }
    if (this.rules.maxFileSize !== null && file.size > this.rules.maxFileSize) {
      file.content = tooLargePlaceholder(file.size);
      return;
    }
    try {
      file.content = decodeContent(await this.fs.readFile(absPath));
    } catch {
      file.content = CONTENT_UNREADABLE;
    }
  }
}
