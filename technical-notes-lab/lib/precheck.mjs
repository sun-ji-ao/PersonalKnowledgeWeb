import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { convertMarkdown, renderHtml, runContentJob } from './html-content.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const inside = (root, candidate) => { const relative = path.relative(root, candidate); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const portable = value => value.split(path.sep).join('/');
export async function resolveResource(root, fromFile, reference) {
  let decoded;
  try { decoded = decodeURIComponent(reference); } catch { throw new Error('PATH_OUTSIDE_ROOT'); }
  // Repeated encoding must never turn into another interpretation at a later layer.
  if (/%[0-9a-f]{2}/i.test(decoded) || /[\u0000-\u001f\\]/.test(decoded) || /^[a-z]:|^\/|^\\/i.test(decoded)) throw new Error('PATH_OUTSIDE_ROOT');
  const candidate = path.resolve(path.dirname(fromFile), decoded);
  if (!inside(root, candidate)) throw new Error('PATH_OUTSIDE_ROOT');
  let actual;
  try { actual = await realpath(candidate); } catch { throw new Error('MISSING_MEDIA'); }
  if (!inside(root, actual)) throw new Error('PATH_OUTSIDE_ROOT');
  return actual;
}
function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return '.png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return '.jpg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return '.gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return null;
}
export async function precheck({ input, output, root: givenRoot, selection, maps = {} }) {
  const actualInput = await realpath(input); const inputStat = await stat(actualInput);
  const root = await realpath(givenRoot || (inputStat.isDirectory() ? actualInput : path.dirname(actualInput)));
  if (!inside(root, actualInput)) throw new Error('Input is outside import root.');
  const resolvedOutput = path.resolve(output);
  const outputParent = await realpath(path.dirname(resolvedOutput));
  const actualOutput = path.join(outputParent, path.basename(resolvedOutput));
  if (inside(root, actualOutput) || inside(actualOutput, root)) throw new Error('Output must be separate from the import root.');
  // Require a new directory; never overwrite a previous report or input.
  await mkdir(actualOutput);
  const files = []; const skipped = [];
  async function scan(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { skipped.push({ path: portable(path.relative(root, filename)), code: 'SYMLINK_SKIPPED' }); continue; }
      if (entry.isDirectory()) await scan(filename);
      else if (/\.md(?:own)?$|\.markdown$/i.test(entry.name)) files.push(filename);
      if (files.length > 10_000) throw new Error('Import inventory exceeds 10000 files.');
    }
  }
  if (selection) {
    for (const relative of selection) {
      const file = await resolveResource(root, path.join(root, '_selection'), relative);
      if (!/\.(md|markdown)$/i.test(file) || !(await stat(file)).isFile()) throw new Error('Selection must contain Markdown files.');
      files.push(file);
    }
  } else if (inputStat.isDirectory()) await scan(actualInput); else files.push(actualInput);
  const uniqueFiles = [...new Set(files)];
  const ids = new Map(uniqueFiles.map(file => [file, `preview-${digest(portable(path.relative(root, file))).slice(0, 16)}`]));
  const report = { schemaVersion: 'notes-html/1', mode: 'offline-precheck-no-database', items: [], media: {}, skipped, totals: { ready: 0, review_required: 0, rejected: 0 }, limits: { inputBytes: 1_900_000, mediaBytes: 10_000_000, workerTimeoutMs: 10000, renderTimeoutMs: 30000 }, databaseWritten: false };
  await mkdir(path.join(actualOutput, 'media'));
  for (const file of uniqueFiles) {
    const relativePath = portable(path.relative(root, file)); const id = ids.get(file); const start = performance.now();
    const mediaMap = { ...(maps.mediaMap || {}) }; const articleMap = { ...(maps.articleMap || {}) }; const resourceDiagnostics = [];
    try {
      const fileSize = (await stat(file)).size;
      if (fileSize > 1_900_000) throw new Error('INPUT_TOO_LARGE');
      const bytes = await readFile(file); const originalHash = digest(bytes);
      const referenceResult = await runContentJob('references', bytes);
      if (referenceResult.diagnostics) resourceDiagnostics.push(...referenceResult.diagnostics);
      for (const ref of referenceResult.references || []) {
        if (/^(?:https?:|mailto:|#)/i.test(ref.url) || Object.hasOwn(ref.kind === 'image' ? mediaMap : articleMap, ref.url)) continue;
        try {
          const resource = await resolveResource(root, file, ref.url);
          if (ref.kind === 'link') { if (ids.has(resource)) articleMap[ref.url] = `/notes/${ids.get(resource)}`; continue; }
          const mediaStat = await stat(resource);
          if (!mediaStat.isFile() || mediaStat.size > 10_000_000) throw new Error('MEDIA_LIMIT');
          const mediaBytes = await readFile(resource); const ext = imageExtension(mediaBytes);
          if (!ext) throw new Error('MEDIA_TYPE_UNSUPPORTED');
          const mediaId = digest(mediaBytes); const mediaFile = `media/${mediaId}${ext}`;
          if (!report.media[mediaId]) { await writeFile(path.join(actualOutput, mediaFile), mediaBytes, { flag: 'wx' }); report.media[mediaId] = mediaFile; }
          mediaMap[ref.url] = `/media/${mediaId}`;
        } catch (error) {
          if (error.message !== 'MISSING_MEDIA') resourceDiagnostics.push({ code: error.message, severity: 'warning', blocksPublishing: true, location: null, message: `Resource not read: ${ref.url}` });
        }
      }
      const converted = await convertMarkdown(bytes, { filename: path.basename(file), mediaMap, articleMap });
      converted.diagnostics.push(...resourceDiagnostics);
      if (converted.status !== 'rejected' && resourceDiagnostics.length) converted.status = 'review_required';
      const rendered = converted.status === 'rejected' ? converted : await renderHtml(converted);
      if (rendered.renderStatus === 'failed' && rendered.status !== 'rejected') rendered.status = 'review_required';
      // Workers can fail before the render implementation returns. Always retain the valid source result.
      const result = rendered.htmlSource === null && converted.htmlSource !== null ? { ...converted, status: 'review_required', renderStatus: 'failed', htmlRendered: null, publishable: false, diagnostics: [...converted.diagnostics, ...rendered.diagnostics] } : rendered;
      if (digest(await readFile(file)) !== originalHash) throw new Error('SOURCE_CHANGED_DURING_CHECK');
      const item = { id, path: relativePath, originalHash, bytes: bytes.length, elapsedMs: Math.round(performance.now() - start), context: { mediaMap, articleMap }, ...result };
      await writeFile(path.join(actualOutput, `${id}.json`), JSON.stringify(item, null, 2), { flag: 'wx' });
      if (result.htmlSource !== null) await writeFile(path.join(actualOutput, `${id}.source.html`), result.htmlSource, { flag: 'wx' });
      if (result.htmlRendered) await writeFile(path.join(actualOutput, `${id}.rendered.html`), result.htmlRendered, { flag: 'wx' });
      report.items.push({ id, path: relativePath, originalHash, status: result.status, renderStatus: result.renderStatus || 'not-run', elapsedMs: item.elapsedMs, diagnostics: result.diagnostics, file: `${id}.json` });
      report.totals[result.status]++;
    } catch (error) {
      report.items.push({ id, path: relativePath, status: 'rejected', diagnostics: [{ code: error.message, severity: 'error', blocksPublishing: true, location: null, message: 'File could not be prechecked.' }] }); report.totals.rejected++;
    }
  }
  report.count = report.items.length;
  await writeFile(path.join(actualOutput, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}
