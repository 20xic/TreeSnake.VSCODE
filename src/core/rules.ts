// Порт core/rule.py: правило матчит только имя (basename), без путей.
// Точное имя, glob (если есть *?[]) или regex с префиксом `re:` / `regex:`.

export type Rule = (name: string) => boolean;

function isRegex(pattern: string): boolean {
  return pattern.startsWith('re:') || pattern.startsWith('regex:');
}

function isGlob(pattern: string): boolean {
  return /[*?[\]]/.test(pattern);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** fnmatch-совместимый glob -> RegExp (`*`, `?`, `[seq]`, `[!seq]`). */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i++];
    if (c === '*') {
      out += '.*';
    } else if (c === '?') {
      out += '.';
    } else if (c === '[') {
      let j = i;
      if (pattern[j] === '!') j++;
      if (pattern[j] === ']') j++;
      while (j < pattern.length && pattern[j] !== ']') j++;
      if (j >= pattern.length) {
        out += '\\[';
      } else {
        let body = pattern.slice(i, j).replace(/\\/g, '\\\\');
        i = j + 1;
        if (body.startsWith('!')) body = '^' + body.slice(1);
        else if (body.startsWith('^')) body = '\\' + body;
        out += `[${body}]`;
      }
    } else {
      out += escapeRegex(c);
    }
  }
  return new RegExp(`^${out}$`, 's');
}

export function compileRule(pattern: string): Rule {
  if (isRegex(pattern)) {
    const expr = pattern.slice(pattern.indexOf(':') + 1).trim();
    let re: RegExp;
    try {
      re = new RegExp(expr);
    } catch {
      // Битая регулярка из настроек не должна ронять весь экспорт.
      return () => false;
    }
    return (name) => re.test(name);
  }
  if (isGlob(pattern)) {
    const re = globToRegExp(pattern);
    return (name) => re.test(name);
  }
  return (name) => name === pattern;
}

export class RuleSet {
  private readonly rules: Rule[];

  constructor(patterns: readonly string[] = []) {
    this.rules = patterns.filter((p) => p.trim() !== '').map(compileRule);
  }

  matches(name: string): boolean {
    return this.rules.some((rule) => rule(name));
  }
}

export interface ScanConfig {
  excludeDirs: string[];
  excludeFiles: string[];
  excludeContentFiles: string[];
  maxFileSize: number | null;
}

export class CompiledRules {
  readonly excludeDirs: RuleSet;
  readonly excludeFiles: RuleSet;
  readonly excludeContentFiles: RuleSet;
  readonly maxFileSize: number | null;

  constructor(config: ScanConfig) {
    this.excludeDirs = new RuleSet(config.excludeDirs);
    this.excludeFiles = new RuleSet(config.excludeFiles);
    this.excludeContentFiles = new RuleSet(config.excludeContentFiles);
    this.maxFileSize = config.maxFileSize;
  }
}
