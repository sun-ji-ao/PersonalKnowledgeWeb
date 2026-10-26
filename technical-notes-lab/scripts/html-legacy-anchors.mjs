import { DatabaseSync } from 'node:sqlite';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertIsolatedDestination } from '../lib/html-migration.mjs';
import { planLegacyAnchors, installLegacyAnchors } from '../lib/html-legacy-anchors.mjs';

const [dbArg, catalogArg, mode] = process.argv.slice(2);
if (!dbArg || !catalogArg || (mode && mode !== '--apply')) throw new Error('Usage: node scripts/html-legacy-anchors.mjs DB CATALOG [--apply]');
const dbPath = realpathSync(path.resolve(dbArg));
assertIsolatedDestination(path.join(path.dirname(dbPath), '.legacy-anchor-guard-new'));
const catalog = JSON.parse(readFileSync(path.resolve(catalogArg), 'utf8'));
const db = new DatabaseSync(dbPath, { readOnly: mode !== '--apply' });
try {
  const result = mode === '--apply' ? installLegacyAnchors(db, catalog) : planLegacyAnchors(db, catalog);
  console.log(JSON.stringify({ dbPath, applied: mode === '--apply', urlCount: result.urlCount, anchorCount: result.anchorCount }, null, 2));
} finally { db.close(); }
