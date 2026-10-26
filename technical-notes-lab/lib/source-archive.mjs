import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, lstatSync, realpathSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function privateRoot(directory) {
  const root = path.resolve(directory);
  // Reject symlinks in every existing ancestor, including Windows junctions.
  let cursor = root;
  while (true) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error('Archive paths cannot contain symbolic links');
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return realpathSync(root);
}
export function archivePath(root, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid archive hash');
  const target = path.join(privateRoot(root), `${hash}.bin`);
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Archive cannot be a symbolic link');
  return target;
}
export function writeArchive(root, bytes, { failpoint } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Original bytes must be Uint8Array');
  const raw = Buffer.from(bytes), hash = sha256(raw), target = archivePath(root, hash);
  if (existsSync(target)) {
    if (sha256(readFileSync(target)) !== hash) throw new Error('Existing archive failed integrity verification');
    return { sha256: hash, byte_length: raw.length };
  }
  const temporary = path.join(path.dirname(target), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, raw, { flag: 'wx', mode: 0o600 });
    if (sha256(readFileSync(temporary)) !== hash) throw new Error('Archive write failed integrity verification');
    failpoint?.('archive-before-rename');
    renameSync(temporary, target);
    failpoint?.('archive-after-rename');
    return { sha256: hash, byte_length: raw.length };
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
export function readArchiveBytes(root, hash) {
  const bytes = readFileSync(archivePath(root, hash));
  if (sha256(bytes) !== hash) throw new Error('Archive failed integrity verification');
  return bytes;
}
