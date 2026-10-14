// Порт core/gitignore_parser.py — то же подмножество синтаксиса:
// без отрицаний и без паттернов с внутренним `/` (RuleSet не знает о путях).

export interface GitignorePatterns {
  dirs: string[];
  files: string[];
}

function clean(rawLine: string): string | null {
  let line = rawLine.trim();
  if (!line || line.startsWith('#') || line.startsWith('!')) return null;
  if (line.startsWith('/')) line = line.slice(1);
  if (!line) return null;
  const bare = line.endsWith('/') ? line.slice(0, -1) : line;
  if (bare.includes('/')) return null;
  return line;
}

export function parseGitignore(text: string): GitignorePatterns {
  const dirs: string[] = [];
  const files: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const pattern = clean(raw);
    if (pattern === null) continue;
    if (pattern.endsWith('/')) {
      dirs.push(pattern.slice(0, -1));
    } else {
      dirs.push(pattern);
      files.push(pattern);
    }
  }
  return { dirs, files };
}
