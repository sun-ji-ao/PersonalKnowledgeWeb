// Validates the contract assets only. Does not call or certify an HTML converter.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const bytes = await readFile(new URL('./cases.json', import.meta.url));
const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
assert.equal(manifest.schemaVersion, 'notes-html/1');
assert.equal(manifest.purpose, 'manually-authored-contract-not-converter-output');
assert.equal(manifest.cases.length, 15);
const ids = new Set();
const counts = { ready: 0, review_required: 0, rejected: 0 };
for (const sample of manifest.cases) {
  assert.ok(!ids.has(sample.id), `Duplicate case: ${sample.id}`);
  ids.add(sample.id);
  assert.ok(['markdown', 'html'].includes(sample.entry), sample.id);
  assert.notEqual(typeof sample.input === 'string', typeof sample.inputHex === 'string', `${sample.id}: exactly one input`);
  if (sample.inputHex !== undefined) assert.match(sample.inputHex, /^(?:[0-9a-f]{2})+$/);
  const input = sample.inputHex === undefined ? Buffer.from(sample.input, 'utf8') : Buffer.from(sample.inputHex, 'hex');
  const expected = sample.expected;
  assert.ok(Object.hasOwn(counts, expected.status), sample.id);
  counts[expected.status]++;
  assert.ok(Array.isArray(expected.diagnosticCodes));
  assert.equal(new Set(expected.diagnosticCodes).size, expected.diagnosticCodes.length);
  if (expected.status === 'rejected') {
    assert.equal(expected.htmlSource, null);
    assert.ok(expected.diagnosticCodes.length > 0);
  } else {
    assert.ok(typeof expected.htmlSource === 'string' && expected.htmlSource.length > 0);
    assert.ok(!expected.htmlSource.includes('\r'), `${sample.id}: canonical LF`);
    if (expected.status === 'review_required') assert.ok(expected.diagnosticCodes.length > 0);
  }
  assert.ok(sample.acceptance.length > 10);
  if (sample.id === 'C10-bom-crlf') {
    assert.equal(input.subarray(0, 3).toString('hex'), 'efbbbf');
    assert.ok(input.includes(Buffer.from('\r\n')));
  }
  if (sample.id === 'C11-invalid-utf8') {
    assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(input));
  } else {
    new TextDecoder('utf-8', { fatal: true }).decode(input);
  }
  console.log(`ASSET OK ${sample.id} (${expected.status}; ${input.length} input bytes)`);
}
console.log(JSON.stringify({ fixtureAssets: ids.size, expectedStatuses: counts,
  manifestSha256: createHash('sha256').update(bytes).digest('hex'),
  converterExecuted: false, editorExecuted: false }));
