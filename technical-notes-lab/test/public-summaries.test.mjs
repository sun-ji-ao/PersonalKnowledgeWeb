import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openHtmlStore } from '../lib/html-store.mjs';
import { normalizeHtml, renderHtml } from '../lib/html-content.mjs';
import { createDiscoveryIndex } from '../lib/html-discovery.mjs';

test('published summary projection preserves order, visibility and indexed body search without loading full DTOs', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'notes-summary-'));
  const discovery = createDiscoveryIndex();
  const store = openHtmlStore(path.join(root, 'notes.sqlite'), { hooks: discovery.hooks });
  discovery.attach(store.db);
  t.after(() => { store.close(); assert.ok(path.basename(root).startsWith('notes-summary-')); rmSync(root, { recursive: true, force: true }); });
  const result = await renderHtml(await normalizeHtml('<h2>Body</h2><p>唯一正文检索词</p>'));
  const make = (title, id) => store.create({ id, title, description: 'summary', category: 'category', tags: ['tag'], result });
  const a = make('A', 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
  const b = make('B', 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
  make('UNPUBLISHED_SECRET', 'cccccccc-cccc-4ccc-cccc-cccccccccccc');
  store.publish(a.id, a.version); store.publish(b.id, b.version);
  // Equal timestamps exercise deterministic ID tie-breaking.
  store.db.prepare('UPDATE html_notes SET published_at=? WHERE published_revision_id IS NOT NULL').run('2026-01-01T00:00:00.000Z');
  const project = ({ html_rendered, headings, ...metadata }) => metadata;
  const expected = store.publicList().map(project);
  const before = store.publicSummaryList();
  assert.deepEqual(before, expected);
  assert.deepEqual(before.map(n => n.id), [a.id, b.id]);
  assert.deepEqual(Object.keys(before[0]).sort(), ['id','created_at','published_at','revision_id','title','description','tags','category'].sort());
  // A full DTO fallback would reintroduce both the per-note reads and body cost.
  store.publicGet = () => { throw new Error('Unexpected full DTO load'); };
  assert.deepEqual(store.publicSummaryList(), before);
  assert.equal(discovery.search(before, { q: '唯一正文检索词' }).length, 2);
  const current = store.get(a.id);
  const draft = store.save(a.id, { version: current.version, title: 'DRAFT_SECRET', category: 'PRIVATE_CATEGORY', result });
  assert.deepEqual(store.publicSummaryList(), before);
  assert.doesNotMatch(JSON.stringify(store.publicSummaryList()), /SECRET|html_rendered|headings|html_source/);
  const published = store.publish(a.id, draft.version);
  assert.equal(store.publicSummaryList().find(n => n.id === a.id).title, 'DRAFT_SECRET');
  store.unpublish(a.id, published.version);
  assert.deepEqual(store.publicSummaryList().map(n => n.id), [b.id]);
  // A malformed cross-note pointer must never expose another note's revision.
  store.db.prepare('UPDATE html_notes SET published_revision_id=? WHERE id=?').run(store.get(b.id).published_revision_id, a.id);
  assert.deepEqual(store.publicSummaryList().map(n => n.id), [b.id]);
});

test('summary size is independent of a large published body and full list retains its contract', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'notes-summary-'));
  const store = openHtmlStore(path.join(root, 'notes.sqlite'));
  t.after(() => { store.close(); assert.ok(path.basename(root).startsWith('notes-summary-')); rmSync(root, { recursive: true, force: true }); });
  const result = await renderHtml(await normalizeHtml('<p>' + 'large body '.repeat(10000) + '</p>'));
  const note = store.create({ title: 'Large article', result });
  store.publish(note.id, note.version);
  const full = store.publicList(), summaries = store.publicSummaryList();
  assert.match(full[0].html_rendered, /large body/);
  assert.ok(Array.isArray(full[0].headings));
  assert.ok(Buffer.byteLength(JSON.stringify(summaries)) < 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(full)) > 100000);
  assert.equal(summaries[0].revision_id, full[0].revision_id);
});
