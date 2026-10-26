import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importMarkdown } from '../lib/content.mjs';
import { openStore } from '../lib/store.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = process.argv[2];
if (!source) { console.error('用法: npm run import -- "Markdown文件或目录的完整路径"'); process.exit(1); }
const sourcePath = path.resolve(source), sourceInfo = await stat(sourcePath);
const store = openStore(path.join(path.resolve(process.env.DATA_DIR || path.join(root, 'data')), 'notes.sqlite'));
let count = 0;
async function visit(target) {
  const info = await stat(target);
  if (info.isDirectory()) { for (const name of await readdir(target)) await visit(path.join(target, name)); return; }
  if (!/\.(md|markdown)$/i.test(target)) return;
  if (info.size > 1_900_000) { console.error(`跳过超过 1.9 MB 的文件：${target}`); return; }
  const note = importMarkdown(await readFile(target, 'utf8'), path.basename(target));
  note.sourceMetadata = { ...note.sourceMetadata, importedFrom: path.relative(sourceInfo.isDirectory() ? sourcePath : path.dirname(sourcePath), target) };
  store.create(note); count++;
}
try { await visit(sourcePath); console.log(`已导入 ${count} 篇私密草稿。未自动发布；重复执行会重复导入。`); }
finally { store.close(); }
