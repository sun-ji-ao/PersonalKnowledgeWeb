import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verify, inventory, run, pack, sync, acquireSyncLock, backupStatus } from '../scripts/backup-maintenance.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

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

test('kernel lock rejects concurrent sync and is released after forced termination', async t => {
  const { root } = fixture(t);
  const moduleUrl = new URL('../scripts/backup-maintenance.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireSyncLock } from ${JSON.stringify(moduleUrl)}; await acquireSyncLock(process.argv[1]); console.log('locked');`, root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await once(child.stdout, 'data');
  await assert.rejects(acquireSyncLock(root), /EADDRINUSE|EACCES/);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const release = await acquireSyncLock(root); await release();
});

test('legacy dead-process lock is preserved and recovered; live and invalid locks are retained', async t => {
  const { root, dir } = fixture(t, new Date().toISOString()), lock = path.join(root, '.sync.lock');
  const config = { host: 'test@example.invalid', key: path.join(root, 'synthetic-key'), destination: root, remoteBase: '/home/test/technical-notes' };
  const transport = async () => JSON.stringify({ healthy: true, valid: [verify(dir)] });
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
  const deadPid = child.pid; await once(child, 'exit');
  fs.writeFileSync(lock, `${deadPid}\n`);
  await sync(config, { transport });
  assert.equal(fs.existsSync(lock), false);
  assert.equal(fs.readdirSync(root).filter(n => n.startsWith('.sync.lock.recovered-')).length, 1);
  fs.writeFileSync(lock, `${process.pid}\n`);
  await assert.rejects(sync(config, { transport }), /still running/);
  assert.ok(backupStatus(root).issues.includes('SYNC_FAILED'));
  assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid}\n`);
  fs.writeFileSync(lock, 'invalid');
  await assert.rejects(sync(config, { transport }), /Invalid legacy/);
  assert.ok(backupStatus(root).issues.includes('SYNC_FAILED'));
});

test('failed sync cannot hide behind a previous success; retry restores healthy state without downloading', async t => {
  const { root, dir } = fixture(t, new Date().toISOString());
  const previous = { checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'sync-last-success.json'), JSON.stringify(previous));
  const config = { host: 'test@example.invalid', key: path.join(root, 'synthetic-key'), destination: root, remoteBase: '/home/test/technical-notes' };
  await assert.rejects(sync(config, { transport: async () => { throw new Error('synthetic connection failure'); } }), /synthetic connection/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'sync-last-success.json'))), previous);
  assert.ok(backupStatus(root).issues.includes('SYNC_FAILED'));
  const report = await sync(config, { transport: async () => JSON.stringify({ healthy: true, valid: [verify(dir)] }) });
  assert.equal(report.downloaded, false);
  assert.equal(backupStatus(root).healthy, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'sync-last-run.json'))).status, 'success');
});

test('monitor reports interrupted runs, stale backups, corrupt state and missing destinations', t => {
  const { root } = fixture(t, new Date().toISOString());
  fs.writeFileSync(path.join(root, 'sync-last-success.json'), JSON.stringify({ checkedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(root, 'sync-last-run.json'), JSON.stringify({ status: 'running', startedAt: new Date(Date.now() - 21 * 60_000).toISOString() }));
  assert.ok(backupStatus(root).issues.includes('SYNC_INTERRUPTED_OR_STALLED'));
  assert.ok(backupStatus(root, Date.now() + 27 * 3600000).issues.includes('BACKUP_STALE_OR_FUTURE'));
  fs.writeFileSync(path.join(root, 'sync-last-run.json'), '{');
  assert.equal(backupStatus(root).healthy, false);
  assert.ok(backupStatus(path.join(root, 'missing')).issues.includes('LOCAL_INVENTORY_UNAVAILABLE'));
});

test('task installer resolves relative config before persisting its action', { skip: process.platform !== 'win32' }, async t => {
  const { root } = fixture(t);
  const config = path.join(root, 'backup config.json');
  fs.writeFileSync(config, JSON.stringify({ destination: root }));
  const installer = fileURLToPath(new URL('../deploy/install-offsite-task.ps1', import.meta.url));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const script = path.join(root, 'installer-probe.ps1');
  fs.writeFileSync(script, `
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath ${quote(root)}
function Get-ScheduledTask { param($TaskName, $ErrorAction) return $null }
function New-ScheduledTaskAction {
  param($Execute, $Argument, $WorkingDirectory)
  if (-not $Argument.Contains(${quote(config)})) { throw 'Configuration was not made absolute' }
  if (-not $Argument.Contains('-WindowStyle Hidden')) { throw 'Background action must be hidden' }
  throw 'ACTION_VERIFIED'
}
try { & ${quote(installer)} -Config './backup config.json'; throw 'Expected action interception' }
catch { if ($_.Exception.Message -ne 'ACTION_VERIFIED') { throw }; Write-Output 'verified' }
`);
  assert.match(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script]), /verified/);
});
