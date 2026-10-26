import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verify, inventory, run, pack } from '../scripts/backup-maintenance.mjs';

function fixture(t, date = '2026-09-28T00:00:00.000Z') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-maintenance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, `backup-${date.replace(/[:.]/g, '-')}-abcdef12`);
  fs.mkdirSync(dir);
  const data = Buffer.from('synthetic-snapshot');
  fs.writeFileSync(path.join(dir, 'notes.sqlite'), data);
  const manifest = { format: 'notes-joint-backup/1', createdAt: date, files: [{ path: 'notes.sqlite', size: data.length, sha256: createHash('sha256').update(data).digest('hex') }] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { root, dir, manifest };
}
test('valid manifest passes; same-size corruption and missing files fail', t => {
  const { dir } = fixture(t);
  assert.equal(verify(dir).files, 1);
  fs.writeFileSync(path.join(dir, 'notes.sqlite'), 'x'.repeat(18));
  assert.throws(() => verify(dir), /Hash mismatch/);
  fs.unlinkSync(path.join(dir, 'notes.sqlite'));
  assert.throws(() => verify(dir), /ENOENT/);
});
test('manifest traversal, Windows paths and duplicate entries are rejected', t => {
  const { dir, manifest } = fixture(t);
  for (const bad of ['../outside', '/outside', 'C:/outside', 'media\\outside']) {
    manifest.files[0].path = bad;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => verify(dir), /Unsafe/);
  }
  manifest.files[0].path = 'notes.sqlite'; manifest.files.push({ ...manifest.files[0] });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => verify(dir), /Unsafe/);
});
test('stale and future backups fail health; retention preview never deletes', t => {
  const { root, dir } = fixture(t);
  assert.equal(inventory(root, Date.parse('2026-09-28T01:00:00Z')).healthy, true);
  assert.equal(inventory(root, Date.parse('2026-09-30T01:00:00Z')).healthy, false);
  assert.equal(inventory(root, Date.parse('2026-09-27T01:00:00Z')).healthy, false);
  const report = inventory(root, Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(report.retention[0].action, 'keep');
  assert.equal(report.automaticDeletion, false);
  assert.ok(fs.existsSync(dir));
});
test('corrupt snapshot is reported and makes inventory unhealthy', t => {
  const { root, dir } = fixture(t);
  fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
  const report = inventory(root);
  assert.equal(report.invalid.length, 1);
  assert.equal(report.healthy, false);
});
test('retention suggests only old snapshots beyond newest seven, without deleting', t => {
  const { root, dir, manifest } = fixture(t, '2026-01-01T00:00:00.000Z');
  for (let i = 2; i <= 8; i++) {
    const createdAt = `2026-01-0${i}T00:00:00.000Z`;
    const next = path.join(root, `backup-${createdAt.replace(/[:.]/g, '-')}-abcdef12`);
    fs.cpSync(dir, next, { recursive: true });
    fs.writeFileSync(path.join(next, 'manifest.json'), JSON.stringify({ ...manifest, createdAt }));
  }
  const report = inventory(root, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(report.retention.filter(x => x.action === 'keep').length, 7);
  assert.equal(report.retention.filter(x => x.action === 'review-for-deletion').length, 1);
  assert.equal(fs.readdirSync(root).length, 8);
});
test('subprocess failure and timeout return errors instead of successful sync', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(7)']), /failed/);
  const start = Date.now();
  await assert.rejects(run(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], 200), /timeout/);
  assert.ok(Date.now() - start < 5000, 'Timeout must stop the child promptly');
});
test('compressed transfer includes only manifest files and verifies after extraction', async t => {
  const { root, dir } = fixture(t);
  fs.writeFileSync(path.join(dir, 'unlisted-secret.txt'), 'must not transfer');
  const archive = await pack(dir);
  const extracted = path.join(root, 'extracted'); fs.mkdirSync(extracted);
  await run('tar', ['-xzf', path.join(root, archive.name), '-C', extracted]);
  assert.equal(verify(extracted).files, 1);
  assert.equal(fs.existsSync(path.join(extracted, 'unlisted-secret.txt')), false);
});
