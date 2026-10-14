// Порт LLMFormatter и XmlFormatter из core/formatter.py — для одного корня
// вывод совпадает с `treesnake scan --fmt llm|xml`.

import { Directory, File } from './models';

export type OutputFormat = 'llm' | 'xml';

export interface Formatter {
  format(roots: Directory[]): string;
}

/** Pre-order обход: [путь_от_корня, директория]. Корень идёт под своим именем. */
export function* walk(directory: Directory): Generator<[string, Directory]> {
  const stack: [string, Directory][] = [[directory.name, directory]];
  while (stack.length) {
    const [path, current] = stack.pop()!;
    yield [path, current];
    for (let i = current.subdirectories.length - 1; i >= 0; i--) {
      const sub = current.subdirectories[i];
      stack.push([`${path}/${sub.name}`, sub]);
    }
  }
}

export class LlmFormatter implements Formatter {
  static readonly FILE_SEPARATOR = '---';

  format(roots: Directory[]): string {
    const out: string[] = [];
    const sep = LlmFormatter.FILE_SEPARATOR;
    for (const root of roots) {
      for (const [path, current] of walk(root)) {
        if (!current.files.length && !current.subdirectories.length) {
          out.push(`# ${path}/\n${sep}\n`);
          continue;
        }
        for (const file of current.files) {
          out.push(`# ${path}/${file.name}\n`);
          if (file.content) out.push(file.content, '\n');
          out.push(`${sep}\n`);
        }
      }
    }
    return out.join('');
  }
}

/** Как xml.sax.saxutils.quoteattr: экранирует &, <, >, переводы строк и выбирает кавычки. */
export function quoteattr(value: string): string {
  let data = value
    .replace(/&/g, '&amp;')
    .replace(/>/g, '&gt;')
    .replace(/</g, '&lt;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
  if (data.includes('"')) {
    if (!data.includes("'")) return `'${data}'`;
    data = data.replace(/"/g, '&quot;');
  }
  return `"${data}"`;
}

export class XmlFormatter implements Formatter {
  static readonly INDENT = '  ';

  format(roots: Directory[]): string {
    const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
    if (roots.length === 1) {
      this.writeDir(roots[0], roots[0].name, 0, out, 'project');
    } else {
      // Мульти-рут воркспейс: у XML должен быть один корневой элемент.
      out.push('<workspace>\n');
      for (const root of roots) this.writeDir(root, root.name, 1, out, 'project');
      out.push('</workspace>\n');
    }
    return out.join('');
  }

  private writeDir(
    directory: Directory,
    path: string,
    depth: number,
    out: string[],
    tag = 'directory',
  ): void {
    const indent = XmlFormatter.INDENT.repeat(depth);
    const name = quoteattr(directory.name);
    if (!directory.files.length && !directory.subdirectories.length) {
      out.push(`${indent}<${tag} name=${name} />\n`);
      return;
    }
    out.push(`${indent}<${tag} name=${name}>\n`);
    for (const file of directory.files) {
      this.writeFile(file, `${path}/${file.name}`, depth + 1, out);
    }
    for (const sub of directory.subdirectories) {
      this.writeDir(sub, `${path}/${sub.name}`, depth + 1, out);
    }
    out.push(`${indent}</${tag}>\n`);
  }

  private writeFile(file: File, path: string, depth: number, out: string[]): void {
    const indent = XmlFormatter.INDENT.repeat(depth);
    const attrs = `name=${quoteattr(file.name)} path=${quoteattr(path)} size="${file.size}"`;
    if (!file.content) {
      out.push(`${indent}<file ${attrs} />\n`);
      return;
    }
    out.push(`${indent}<file ${attrs}><![CDATA[\n`);
    out.push(file.content.split(']]>').join(']]]]><![CDATA[>'));
    if (!file.content.endsWith('\n')) out.push('\n');
    out.push(']]></file>\n');
  }
}

export function getFormatter(format: OutputFormat): Formatter {
  return format === 'xml' ? new XmlFormatter() : new LlmFormatter();
}

export const FILE_EXTENSIONS: Record<OutputFormat, string> = {
  llm: 'txt',
  xml: 'xml',
};
