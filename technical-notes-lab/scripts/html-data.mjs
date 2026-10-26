import path from 'node:path';
import { existsSync } from 'node:fs';
import { inspectDatabase, createJointBackup, restoreJointBackup } from '../lib/html-backup.mjs';
import { migrateLegacyDatabase, assertIsolatedDestination } from '../lib/html-migration.mjs';

const [command, ...args] = process.argv.slice(2);
const usage = 'Usage: node scripts/html-data.mjs inspect DB | backup DATA_DIR NEW_BACKUP_DIR [--db DB --archives ARCHIVE_DIR] [--media MEDIA_DIR] | restore BACKUP_DIR NEW_DATA_DIR | migrate LEGACY_DB NEW_DATA_DIR';

function backupInput(args) {
  if (args.length < 2 || args[0].startsWith('--') || args[1].startsWith('--')) throw new Error(usage);
  const dataDir = path.resolve(args[0]), options = {};
  for (let index = 2; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--db', '--archives', '--media'].includes(flag) || !value || value.startsWith('--') || Object.hasOwn(options, flag)) throw new Error(usage);
    options[flag] = path.resolve(value);
  }
  if (!!options['--db'] !== !!options['--archives']) throw new Error('Explicit backup requires both --db DB and --archives ARCHIVE_DIR; use the same paths as HTML_DB_PATH and HTML_ARCHIVE_DIR.');
  let dbPath = options['--db'], archiveDir = options['--archives'];
  if (!dbPath) {
    const candidates = [
      { dbPath: path.join(dataDir, 'notes.sqlite'), archiveDir: path.join(dataDir, 'source-archives') },
      { dbPath: path.join(dataDir, 'html-notes.sqlite'), archiveDir: path.join(dataDir, 'html-archives') },
    ].filter(candidate => existsSync(candidate.dbPath));
    if (candidates.length !== 1) throw new Error(candidates.length
      ? 'Ambiguous data directory contains notes.sqlite and html-notes.sqlite. Specify --db DB --archives ARCHIVE_DIR; no backup was created.'
      : 'No standard database found. Specify --db DB --archives ARCHIVE_DIR; no backup was created.');
    ({ dbPath, archiveDir } = candidates[0]);
  }
  // Resolve the source before creating any staging destination. This is read-only.
  if (inspectDatabase(dbPath).integrity !== 'ok') throw new Error('Source database integrity check failed');
  return { dbPath, archiveDir, mediaDir: options['--media'] || path.join(dataDir, 'media'), destination: assertIsolatedDestination(args[1]) };
}
try {
  let result;
  if (command === 'inspect' && args.length === 1) result = inspectDatabase(path.resolve(args[0]));
  else if (command === 'backup') { const input = backupInput(args); result = { ...await createJointBackup(input), source: { dbPath: input.dbPath, archiveDir: input.archiveDir, mediaDir: input.mediaDir } }; }
  else if (command === 'restore' && args.length === 2) result = restoreJointBackup({ backupDir: path.resolve(args[0]), destination: assertIsolatedDestination(args[1]) });
  else if (command === 'migrate' && args.length === 2) result = await migrateLegacyDatabase({ sourceDbPath: path.resolve(args[0]), destination: path.resolve(args[1]) });
  else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
  if (result.fallback) process.exitCode = 2;
} catch (error) { console.error(JSON.stringify({ error: error.message, code: error.code || 'DATA_OPERATION_FAILED' })); process.exitCode = 1; }
