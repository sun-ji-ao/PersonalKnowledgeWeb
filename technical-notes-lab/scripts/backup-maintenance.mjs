import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const namePattern = /^backup-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]+$/;
function regular(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular file: ${file}`);
  return stat;
}
export function verify(directory) {
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('Invalid backup directory');
  regular(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'notes-joint-backup/1' || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid manifest');
  const seen = new Set();
  let bytes = 0;
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !/^[a-zA-Z0-9._/-]+$/.test(entry.path) || entry.path.split('/').some(p => !p || p === '.' || p === '..') || seen.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Unsafe or invalid manifest entry');
    seen.add(entry.path);
    const parts = entry.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const stat = fs.lstatSync(path.join(directory, ...parts.slice(0, i)));
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe parent directory');
    }
    const filename = path.join(directory, ...parts);
    if (regular(filename).size !== entry.size) throw new Error(`Size mismatch: ${entry.path}`);
    if (createHash('sha256').update(fs.readFileSync(filename)).digest('hex') !== entry.sha256) throw new Error(`Hash mismatch: ${entry.path}`);
    bytes += entry.size;
  }
  if (!seen.has('notes.sqlite')) throw new Error('Database missing from manifest');
  return { name: path.basename(directory), createdAt: manifest.createdAt, files: seen.size, bytes };
}

export function inventory(root, now = Date.now(), maxAgeHours = 26) {
  const valid = [], invalid = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!namePattern.test(entry.name)) continue;
    try { valid.push(verify(path.join(root, entry.name))); }
    catch (error) { invalid.push({ name: entry.name, error: error.message }); }
  }
  valid.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const ageHours = valid.length ? (now - Date.parse(valid[0].createdAt)) / 3600000 : null;
  // Preview only: retain all snapshots for 30 days, plus the latest seven regardless of age.
  const retention = valid.map((item, i) => ({ name: item.name, action: i < 7 || now - Date.parse(item.createdAt) <= 30 * 86400000 ? 'keep' : 'review-for-deletion' }));
  const space = fs.statfsSync(root);
  const freeBytes = space.bavail * space.bsize;
  const healthy = ageHours !== null && ageHours >= -0.1 && ageHours <= maxAgeHours && invalid.length === 0 && freeBytes >= 1024 ** 3;
  return { checkedAt: new Date(now).toISOString(), healthy, ageHours, maxAgeHours, freeBytes, minimumFreeBytes: 1024 ** 3, valid, invalid, retention, automaticDeletion: false };
}

export function run(command, args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure;
    const stop = reason => {
      failure = reason;
      if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 1500 });
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop('transfer timeout'), timeoutMs);
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 8 * 1024 * 1024) stop('output limit exceeded'); });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-16384); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); if (failure || code !== 0) reject(new Error(`${command} failed: ${failure || stderr || code}`)); else resolve(stdout); });
  });
}

export async function pack(directory) {
  const checked = verify(directory);
  if (!namePattern.test(checked.name)) throw new Error('Invalid snapshot name');
  const archive = path.join(path.dirname(directory), `.transfer-${checked.name}.tar.gz`);
  const temporary = `${archive}.${randomUUID()}.tmp`;
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  await run('tar', ['-czf', temporary, '-C', directory, 'manifest.json', ...manifest.files.map(entry => entry.path)]);
  fs.renameSync(temporary, archive);
  return { name: path.basename(archive) };
}

export async function sync(config) {
  const { host, key, destination, remoteBase } = config;
  if (!/^[a-zA-Z0-9_-]+@[a-zA-Z0-9.-]+$/.test(host) || !/^\/[a-zA-Z0-9_/-]+$/.test(remoteBase) || !path.isAbsolute(destination) || !path.isAbsolute(key)) throw new Error('Invalid sync configuration');
  const port = String(config.port || 22);
  if (!/^\d+$/.test(port)) throw new Error('Invalid SSH port');
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const lock = path.join(destination, '.sync.lock');
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${process.pid}\n`);
    const args = ['-i', key, '-p', port, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host];
    const command = `${remoteBase}/node-runtime/node_modules/node/bin/node ${remoteBase}/backup-maintenance.mjs inventory ${remoteBase}/backups`;
    const remote = JSON.parse(await run('ssh', [...args, command]));
    if (!remote.healthy) throw new Error('Remote backup inventory is unhealthy; inspect server inventory');
    const latest = remote.valid[0];
    if (!latest || !namePattern.test(latest.name)) throw new Error('Unsafe remote snapshot name');
    const target = path.join(destination, latest.name);
    let downloaded = false;
    if (!fs.existsSync(target)) {
      const staging = path.join(destination, `.incoming-${randomUUID()}`);
      fs.mkdirSync(staging, { mode: 0o700 });
      const packed = JSON.parse(await run('ssh', [...args, `${remoteBase}/node-runtime/node_modules/node/bin/node ${remoteBase}/backup-maintenance.mjs pack ${remoteBase}/backups/${latest.name}`]));
      if (packed.name !== `.transfer-${latest.name}.tar.gz`) throw new Error('Invalid transfer archive name');
      const archive = path.join(staging, packed.name);
      await run('scp', ['-O', '-i', key, '-P', port, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', `${host}:${remoteBase}/backups/${packed.name}`, archive]);
      const entries = (await run('tar', ['-tzf', archive])).trim().split(/\r?\n/);
      if (entries.some(entry => !/^[a-zA-Z0-9._/-]+$/.test(entry) || entry.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('Unsafe transport archive');
      const extracted = path.join(staging, latest.name);
      fs.mkdirSync(extracted, { mode: 0o700 });
      await run('tar', ['-xzf', archive, '-C', extracted]);
      verify(extracted);
      fs.renameSync(extracted, target);
      fs.unlinkSync(archive);
      fs.rmdirSync(staging);
      downloaded = true;
    }
    const verified = verify(target);
    const report = { checkedAt: new Date().toISOString(), downloaded, verified, inventory: inventory(destination) };
    fs.writeFileSync(path.join(destination, 'sync-last-success.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    return report;
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, value] = process.argv.slice(2);
    let report;
    if (command === 'verify') report = verify(path.resolve(value));
    else if (command === 'pack') report = await pack(path.resolve(value));
    else if (command === 'inventory' || command === 'check') {
      report = inventory(path.resolve(value || path.join(os.homedir(), 'technical-notes/backups')));
      if (command === 'check' && !report.healthy) process.exitCode = 2;
    } else if (command === 'sync') {
      report = await sync(JSON.parse(fs.readFileSync(value, 'utf8')));
      if (!report.inventory.healthy) process.exitCode = 2;
    }
    else throw new Error('Usage: backup-maintenance.mjs verify|inventory|check DIRECTORY | sync CONFIG.json');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
