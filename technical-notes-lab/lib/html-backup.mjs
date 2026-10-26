import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, writeFileSync, readFileSync, copyFileSync, readdirSync, lstatSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256, privateRoot, readArchiveBytes } from './source-archive.mjs';

function tableExists(db, name) { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name); }
export function inspectDatabase(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name), legacyNotes: tableExists(db, 'notes') ? db.prepare('SELECT COUNT(*) AS count FROM notes').get().count : 0, htmlNotes: tableExists(db, 'html_notes') ? db.prepare('SELECT COUNT(*) AS count FROM html_notes').get().count : 0 }; } finally { db.close(); }
}
export async function backupDatabase(dbPath, destination) {
  if (existsSync(destination)) throw new Error('Backup destination must not exist');
  privateRoot(path.dirname(destination));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { await backup(db, destination); } finally { db.close(); }
  if (inspectDatabase(destination).integrity !== 'ok') throw new Error('Backup database integrity check failed');
  return destination;
}
function fileManifest(root, relative) {
  const filename = path.join(root, ...relative.split('/'));
  const bytes = readFileSync(filename); return { path: relative, size: bytes.length, sha256: sha256(bytes) };
}
function regularTree(root) {
  const files = [];
  function walk(directory, relative = '') { for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name), item = relative ? `${relative}/${entry.name}` : entry.name;
    if (lstatSync(filename).isSymbolicLink()) throw new Error('Backup trees cannot contain symbolic links');
    if (entry.isDirectory()) walk(filename, item); else if (entry.isFile()) files.push(item); else throw new Error('Unsupported backup file type');
  } }
  walk(root); return files;
}
export async function createJointBackup({ dbPath, archiveDir = path.join(path.dirname(dbPath), 'source-archives'), mediaDir, destination }) {
  if (existsSync(destination)) throw new Error('Backup destination must not exist');
  const target = path.resolve(destination), staging = `${target}.incomplete-${randomUUID()}`;
  privateRoot(staging);
  // Snapshot database first; all referenced archives are immutable and never removed automatically.
  await backupDatabase(dbPath, path.join(staging, 'notes.sqlite'));
  const snapshot = new DatabaseSync(path.join(staging, 'notes.sqlite'), { readOnly: true });
  let archives, media;
  try {
    archives = tableExists(snapshot, 'source_archives') ? snapshot.prepare('SELECT DISTINCT sha256,byte_length FROM source_archives').all() : [];
    media = tableExists(snapshot, 'media') ? snapshot.prepare('SELECT id,byte_length FROM media').all() : [];
    if (tableExists(snapshot, 'revision_media') && snapshot.prepare('SELECT 1 FROM revision_media r JOIN html_notes n ON n.published_revision_id=r.revision_id LEFT JOIN media m ON m.id=r.media_id WHERE m.id IS NULL LIMIT 1').get()) throw new Error('Database has missing referenced media');
  } finally { snapshot.close(); }
  privateRoot(path.join(staging, 'source-archives'));
  const files = [fileManifest(staging, 'notes.sqlite')];
  for (const archive of archives) {
    const bytes = readArchiveBytes(archiveDir, archive.sha256);
    if (bytes.length !== archive.byte_length) throw new Error('Archive size mismatch');
    const relative = `source-archives/${archive.sha256}.bin`;
    writeFileSync(path.join(staging, relative), bytes, { flag: 'wx', mode: 0o600 });
    files.push(fileManifest(staging, relative));
  }
  if (media.length && !mediaDir) throw new Error('Media directory is required for a complete joint backup');
  for (const item of media) {
    const bytes = readArchiveBytes(mediaDir, item.id);
    if (bytes.length !== item.byte_length) throw new Error('Media size mismatch');
  }
  // Immutable content-addressed media plus any explicitly supplied legacy files.
  if (mediaDir && existsSync(mediaDir)) {
    const root = privateRoot(mediaDir);
    for (const relative of regularTree(root)) {
      const before = fileManifest(root, relative), destinationFile = path.join(staging, 'media', relative);
      privateRoot(path.dirname(destinationFile)); copyFileSync(path.join(root, relative), destinationFile);
      const copied = fileManifest(staging, `media/${relative}`);
      if (copied.sha256 !== before.sha256 || fileManifest(root, relative).sha256 !== before.sha256) throw new Error('Media changed during backup; retry with media writes paused');
      files.push(copied);
    }
  }
  const manifest = { format: 'notes-joint-backup/1', createdAt: new Date().toISOString(), files };
  writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  renameSync(staging, target); return { directory: target, manifest };
}
function safeManifestPath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.split('/').some(part => !part || part === '.' || part === '..') || !/^(notes\.sqlite|source-archives\/[a-f0-9]{64}\.bin|media\/.+)$/.test(relative)) throw new Error('Unsafe backup manifest path');
  const target = path.resolve(root, ...relative.split('/'));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Backup path escapes root');
  let cursor = target; while (cursor !== path.resolve(root)) { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Backup cannot contain symbolic links'); cursor = path.dirname(cursor); }
  return target;
}
export function restoreJointBackup({ backupDir, destination }) {
  if (existsSync(destination)) throw new Error('Restore destination must not exist; restore never overwrites live data');
  const root = path.resolve(backupDir);
  if (lstatSync(root).isSymbolicLink() || lstatSync(path.join(root, 'manifest.json')).isSymbolicLink()) throw new Error('Backup root/manifest cannot be a symbolic link');
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'notes-joint-backup/1' || !Array.isArray(manifest.files) || !manifest.files.some(f => f.path === 'notes.sqlite')) throw new Error('Invalid joint backup manifest');
  const seen = new Set();
  for (const file of manifest.files) { if (seen.has(file.path)) throw new Error('Duplicate manifest path'); seen.add(file.path); const bytes = readFileSync(safeManifestPath(root, file.path)); if (sha256(bytes) !== file.sha256 || bytes.length !== file.size) throw new Error(`Backup checksum mismatch: ${file.path}`); }
  const snapshot = new DatabaseSync(path.join(root, 'notes.sqlite'), { readOnly: true });
  try {
    if (snapshot.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup SQLite integrity check failed');
    if (tableExists(snapshot, 'source_archives')) for (const archive of snapshot.prepare('SELECT sha256,byte_length FROM source_archives').all()) {
      const file = manifest.files.find(f => f.path === `source-archives/${archive.sha256}.bin`);
      if (!file || file.sha256 !== archive.sha256 || file.size !== archive.byte_length) throw new Error('Manifest is missing a referenced archive');
    }
    if (tableExists(snapshot, 'media')) for (const item of snapshot.prepare('SELECT id,byte_length FROM media').all()) {
      const file = manifest.files.find(f => f.path === `media/${item.id}.bin`);
      if (!file || file.sha256 !== item.id || file.size !== item.byte_length) throw new Error('Manifest is missing referenced media');
    }
    if (tableExists(snapshot, 'revision_media') && snapshot.prepare('SELECT 1 FROM revision_media r JOIN html_notes n ON n.published_revision_id=r.revision_id LEFT JOIN media m ON m.id=r.media_id WHERE m.id IS NULL LIMIT 1').get()) throw new Error('Database has missing referenced media');
  } finally { snapshot.close(); }
  const target = path.resolve(destination), staging = `${target}.incomplete-${randomUUID()}`; privateRoot(staging);
  for (const file of manifest.files) { const dest = path.join(staging, ...file.path.split('/')); privateRoot(path.dirname(dest)); copyFileSync(safeManifestPath(root, file.path), dest); const copied = readFileSync(dest); if (sha256(copied) !== file.sha256 || copied.length !== file.size) throw new Error('Backup changed during restore'); }
  privateRoot(path.join(staging, 'source-archives'));
  privateRoot(path.join(staging, 'media'));
  renameSync(staging, target); return { directory: target, dbPath: path.join(target, 'notes.sqlite'), archiveDir: path.join(target, 'source-archives'), mediaDir: path.join(target, 'media') };
}
