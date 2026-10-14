import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { LlmFormatter, XmlFormatter, quoteattr } from '../core/formatters';
import { parseGitignore } from '../core/gitignore';
import { Directory } from '../core/models';
import { CompiledRules, RuleSet } from '../core/rules';
import { CONTENT_UNREADABLE, EntryType, FileSystem, Scanner, decodeContent } from '../core/scanner';
import { SelectionState } from '../core/selection';

const nodeFs: FileSystem = {
  async readDirectory(p) {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return entries.map((e): [string, EntryType] => [
      e.name,
      e.isDirectory() ? 'directory' : e.isFile() ? 'file' : 'other',
    ]);
  },
  async stat(p) {
    const s = await fs.stat(p);
    return { type: s.isDirectory() ? 'directory' : 'file', size: s.size };
  },
  readFile: (p) => fs.readFile(p),
};

const noRules = new CompiledRules({ excludeDirs: [], excludeFiles: [], excludeContentFiles: [], maxFileSize: null });

async function fixture(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'treesnake-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (!rel.endsWith('/')) await fs.writeFile(abs, content);
  }
  return root;
}

const tree: Directory = {
  name: 'proj',
  files: [{ name: 'main.py', content: 'print("hi")\n', size: 12 }],
  subdirectories: [
    { name: 'empty', files: [], subdirectories: [] },
    {
      name: 'core',
      files: [
        { name: 'a.txt', content: 'x ]]> y', size: 7 },
        { name: 'skip.lock', content: '', size: 3 },
      ],
      subdirectories: [],
    },
  ],
};

test('LLM formatter matches CLI layout', () => {
  assert.equal(
    new LlmFormatter().format([tree]),
    '# proj/main.py\nprint("hi")\n\n---\n' +
      '# proj/empty/\n---\n' +
      '# proj/core/a.txt\nx ]]> y\n---\n' +
      '# proj/core/skip.lock\n---\n',
  );
});

test('XML formatter nests directories and splits ]]> in CDATA', () => {
  assert.equal(
    new XmlFormatter().format([tree]),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<project name="proj">\n' +
      '  <file name="main.py" path="proj/main.py" size="12"><![CDATA[\nprint("hi")\n]]></file>\n' +
      '  <directory name="empty" />\n' +
      '  <directory name="core">\n' +
      '    <file name="a.txt" path="proj/core/a.txt" size="7"><![CDATA[\nx ]]]]><![CDATA[> y\n]]></file>\n' +
      '    <file name="skip.lock" path="proj/core/skip.lock" size="3" />\n' +
      '  </directory>\n' +
      '</project>\n',
  );
});

test('XML wraps several roots in <workspace>', () => {
  const out = new XmlFormatter().format([
    { name: 'a', files: [], subdirectories: [] },
    { name: 'b', files: [], subdirectories: [] },
  ]);
  assert.equal(out, '<?xml version="1.0" encoding="UTF-8"?>\n<workspace>\n  <project name="a" />\n  <project name="b" />\n</workspace>\n');
});

test('quoteattr mirrors xml.sax.saxutils', () => {
  assert.equal(quoteattr('a&b<c>'), '"a&amp;b&lt;c&gt;"');
  assert.equal(quoteattr('say "hi"'), `'say "hi"'`);
  assert.equal(quoteattr(`it's "x"`), `"it's &quot;x&quot;"`);
});

test('rules: exact, glob, regex', () => {
  const rules = new RuleSet(['.git', '*.pyc', 'file[0-9].txt', 're:^test_.*', 'regex:(']);
  assert.ok(rules.matches('.git'));
  assert.ok(!rules.matches('.github'));
  assert.ok(rules.matches('x.pyc'));
  assert.ok(rules.matches('file3.txt'));
  assert.ok(!rules.matches('fileA.txt'));
  assert.ok(rules.matches('test_scanner.py'));
  assert.ok(!rules.matches('my_test.py'));
});

test('gitignore subset', () => {
  const p = parseGitignore('# c\n\nnode_modules/\n/dist\n*.log\n!keep.log\nbuild/temp\n');
  assert.deepEqual(p.dirs, ['node_modules', 'dist', '*.log']);
  assert.deepEqual(p.files, ['dist', '*.log']);
});

test('selection: folder check, child uncheck, partial', () => {
  const s = new SelectionState();
  s.set('src', true);
  assert.ok(s.isSelected('src/a/b.ts'));
  s.set('src/a/b.ts', false);
  assert.ok(!s.isSelected('src/a/b.ts'));
  assert.ok(s.isSelected('src/a/c.ts'));
  assert.ok(s.isPartial('src'));
  assert.ok(s.isPartial(''));
  s.set('src', false);
  assert.ok(s.isEmpty);
  s.set('docs/readme.md', true);
  assert.ok(s.hasSelectedDescendants('docs'));
  assert.ok(!s.isSelected('docs'));
  assert.deepEqual(SelectionState.fromJSON(s.toJSON()).toJSON(), s.toJSON());
});

test('decodeContent: binary, bad utf-8, CRLF', () => {
  assert.equal(decodeContent(new Uint8Array([104, 0, 105])), CONTENT_UNREADABLE);
  assert.equal(decodeContent(new Uint8Array([0xff, 0xfe, 0x41])), CONTENT_UNREADABLE);
  assert.equal(decodeContent(new TextEncoder().encode('a\r\nb\rc')), 'a\nb\nc');
});

test('scanner keeps only the selected part of the tree', async () => {
  const root = await fixture({
    'a.txt': 'A',
    'src/x.ts': 'X',
    'src/y.ts': 'Y',
    'src/deep/z.ts': 'Z',
    'other/o.txt': 'O',
    'node_modules/m.js': 'M',
    'big.txt': '0123456789',
    'yarn.lock': 'L',
  });
  const rules = new CompiledRules({
    excludeDirs: ['node_modules'],
    excludeFiles: [],
    excludeContentFiles: ['*.lock'],
    maxFileSize: 5,
  });
  const sel = new SelectionState();
  sel.set('src', true);
  sel.set('src/y.ts', false);
  sel.set('big.txt', true);
  sel.set('yarn.lock', true);

  const tree = await new Scanner(nodeFs, rules).scan(root, 'proj', sel);
  assert.equal(
    new LlmFormatter().format([tree!]),
    '# proj/big.txt\n[File too large: 10 bytes]\n---\n' +
      '# proj/yarn.lock\n---\n' +
      '# proj/src/x.ts\nX\n---\n' +
      '# proj/src/deep/z.ts\nZ\n---\n',
  );

  const all = new SelectionState();
  all.set('', true);
  const full = await new Scanner(nodeFs, rules).scan(root, 'proj', all);
  assert.ok(!new LlmFormatter().format([full!]).includes('node_modules'));

  assert.equal(await new Scanner(nodeFs, noRules).scan(root, 'proj', new SelectionState()), null);
});
