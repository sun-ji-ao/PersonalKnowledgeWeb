import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { inspectDatabase, restoreJointBackup } from '../lib/html-backup.mjs';
import { DatabaseSync } from 'node:sqlite';

const [backupDir, destination] = process.argv.slice(2);
if (!backupDir || !destination) throw new Error('Usage: node scripts/html-recovery-drill.mjs BACKUP_DIR NEW_RESTORE_DIR');
const restored = restoreJointBackup({ backupDir: path.resolve(backupDir), destination: path.resolve(destination) });
const inspected = inspectDatabase(restored.dbPath);
if (inspected.integrity !== 'ok') throw new Error('Restored SQLite integrity failed');
const db = new DatabaseSync(restored.dbPath, { readOnly: true });
let counts, sample;
try {
  counts = {
    notes: db.prepare('SELECT COUNT(*) AS n FROM html_notes').get().n,
    published: db.prepare('SELECT COUNT(*) AS n FROM html_notes WHERE published_revision_id IS NOT NULL').get().n,
    archives: db.prepare('SELECT COUNT(*) AS n FROM source_archives').get().n,
    media: db.prepare("SELECT COUNT(*) AS n FROM media").get().n,
  };
  const hasLegacy = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_urls'").get();
  sample = hasLegacy ? db.prepare('SELECT l.url,l.note_id,n.published_revision_id FROM legacy_urls l JOIN html_notes n ON n.id=l.note_id ORDER BY n.published_revision_id IS NULL,l.url LIMIT 1').get() : null;
} finally { db.close(); }
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const runtime = mkdtempSync(path.join(os.tmpdir(), 'notes-recovery-runtime-'));
const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const child = spawn(process.execPath, ['server.mjs'], { cwd: app, env: {
  ...process.env, HTML_EDITOR: '1', DEPLOYMENT_MODE: 'production', PUBLIC_ORIGIN: 'https://sunjiao.me',
  DATA_DIR: runtime, HTML_DB_PATH: restored.dbPath, HTML_ARCHIVE_DIR: restored.archiveDir,
  HTML_MEDIA_DIR: restored.mediaDir, SEED_DEMO: '0', ADMIN_PASSWORD: 'Recovery-drill-only-password', PORT: String(port),
}, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => logs += value); child.stderr.on('data', value => logs += value);
try {
  let ready = false;
  for (let index = 0; index < 100; index++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${origin}/_health`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  if (!ready) throw new Error(`Restored service did not become ready: ${logs}`);
  const publicNotes = await (await fetch(`${origin}/api/public/notes`)).json();
  if (publicNotes.length !== counts.published) throw new Error('Restored public count differs from SQLite');
  let legacyStatus = null;
  if (sample) {
    const response = await fetch(`${origin}${encodeURI(sample.url)}`, { redirect: 'manual' });
    legacyStatus = response.status;
    if (legacyStatus !== (sample.published_revision_id ? 302 : 404)) throw new Error('Old URL visibility changed after restore');
  }
  const privateStatus = (await fetch(`${origin}/api/html/notes`)).status;
  if (privateStatus !== 401) throw new Error('Private API became anonymous after restore');
  const report = { restored: restored.directory, integrity: inspected.integrity, ...counts, legacyStatus, privateStatus, rssOrigin: (await (await fetch(`${origin}/rss.xml`)).text()).includes('https://sunjiao.me') };
  if (!report.rssOrigin && counts.published) throw new Error('Public origin was lost in restored RSS');
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
  if (path.resolve(runtime).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(runtime).startsWith('notes-recovery-runtime-')) rmSync(runtime, { recursive: true, force: true });
}
