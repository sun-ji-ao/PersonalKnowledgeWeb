import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { precheck } from '../lib/precheck.mjs';
const options = { input: { type: 'string' }, output: { type: 'string' }, root: { type: 'string' }, select: { type: 'string' }, maps: { type: 'string' }, help: { type: 'boolean' } };
try {
  const { values } = parseArgs({ options, strict: true });
  if (values.help) console.log('node scripts/precheck.mjs --input <file-or-directory> --output <NEW-directory> [--root <import-root>] [--select <JSON-relative-path-array>] [--maps <JSON-resource-maps>]\nExit: 0 all ready, 2 review/rejected items, 1 invocation/output failure. Does not write a database.');
  else {
    if (!values.input || !values.output) throw new Error('--input and --output are required.');
    const selection = values.select ? JSON.parse(await readFile(values.select, 'utf8')) : undefined;
    if (selection && (!Array.isArray(selection) || selection.some(p => typeof p !== 'string'))) throw new Error('--select must contain a JSON array of relative paths.');
    const maps = values.maps ? JSON.parse(await readFile(values.maps, 'utf8')) : {};
    const result = await precheck({ ...values, selection, maps });
    console.log(JSON.stringify({ output: values.output, count: result.count, totals: result.totals, skipped: result.skipped.length, databaseWritten: false }, null, 2));
    process.exitCode = result.totals.review_required || result.totals.rejected ? 2 : 0;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
