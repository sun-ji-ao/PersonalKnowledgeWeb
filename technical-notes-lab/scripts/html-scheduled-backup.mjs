import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createJointBackup } from '../lib/html-backup.mjs';

const { DATA_DIR, HTML_DB_PATH, HTML_ARCHIVE_DIR, HTML_MEDIA_DIR, BACKUP_DIR } = process.env;
if (!DATA_DIR || !HTML_DB_PATH || !HTML_ARCHIVE_DIR || !HTML_MEDIA_DIR || !BACKUP_DIR) throw new Error('Backup requires explicit runtime, database, archive, media and backup paths');
const root = path.resolve(BACKUP_DIR);
mkdirSync(root, { recursive: true, mode: 0o700 });
const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
const result = await createJointBackup({ dbPath: path.resolve(HTML_DB_PATH), archiveDir: path.resolve(HTML_ARCHIVE_DIR), mediaDir: path.resolve(HTML_MEDIA_DIR), destination: path.join(root, name) });
console.log(JSON.stringify({ directory: result.directory, files: result.manifest.files.length, createdAt: result.manifest.createdAt }));
