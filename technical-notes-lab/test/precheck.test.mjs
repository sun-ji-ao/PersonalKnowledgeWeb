import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { precheck, resolveResource } from '../lib/precheck.mjs';
import { convertMarkdown } from '../lib/html-content.mjs';
const appRoot = new URL('../', import.meta.url);
test('precheck CLI and single converter agree; sources unchanged, resource and output boundaries hold', async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'notes-precheck-'));
  t.after(async () => { assert.ok(path.basename(temporary).startsWith('notes-precheck-')); assert.equal(path.dirname(temporary), path.resolve(tmpdir())); await rm(temporary, { recursive: true, force: true }); });
  const root = path.join(temporary, 'input'); await mkdir(root);
  const fixtures = JSON.parse(await readFile(new URL('../../doc/technical-notes-lab/batch-01/cases.json', import.meta.url), 'utf8'));
  const samples = fixtures.cases.filter(c => c.entry === 'markdown');
  const maps = { mediaMap: {}, articleMap: {} };
  for (const c of samples) { await writeFile(path.join(root, c.filename), c.inputHex ? Buffer.from(c.inputHex, 'hex') : c.input); Object.assign(maps.mediaMap, c.context?.mediaMap); Object.assign(maps.articleMap, c.context?.articleMap); }
  const mapsPath = path.join(temporary, 'maps.json'); await writeFile(mapsPath, JSON.stringify(maps));
  const output = path.join(temporary, 'output');
  const invocation = spawnSync(process.execPath, ['scripts/precheck.mjs', '--input', root, '--output', output, '--maps', mapsPath], { cwd: appRoot, encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.equal(invocation.status, 2, invocation.stderr);
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
  assert.equal(report.count, samples.length); assert.equal(report.databaseWritten, false);
  for (const c of samples) {
    const item = report.items.find(i => i.path === c.filename);
    assert.ok(item);
    const actual = JSON.parse(await readFile(path.join(output, item.file), 'utf8'));
    const bytes = c.inputHex ? Buffer.from(c.inputHex, 'hex') : Buffer.from(c.input);
    assert.deepEqual(await readFile(path.join(root, c.filename)), bytes);
    const single = await convertMarkdown(bytes, { filename: c.filename, ...actual.context });
    assert.equal(actual.htmlSource, single.htmlSource);
    assert.deepEqual(actual.metadata, single.metadata);
  }
  await assert.rejects(precheck({ input: root, output }), /EEXIST/);
  await assert.rejects(precheck({ input: root, output: path.join(root, 'output') }), /separate/);
  const filename = path.join(root, 'intro.md');
  for (const unsafe of ['../outside.png', '%2e%2e/outside.png', 'C:/Windows/a.png', '//server/share/a.png', '\\server\\a', '%252e%252e/a']) await assert.rejects(resolveResource(root, filename, unsafe), /PATH_OUTSIDE_ROOT/);
  const outside = path.join(temporary, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'private.png'), 'private');
  await symlink(outside, path.join(root, 'escape'), 'junction');
  await assert.rejects(resolveResource(root, filename, './escape/private.png'), /PATH_OUTSIDE_ROOT/);
});
