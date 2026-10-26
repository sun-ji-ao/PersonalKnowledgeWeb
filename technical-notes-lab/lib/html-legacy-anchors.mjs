export function planLegacyAnchors(db, catalog) {
  if (!catalog || typeof catalog.entries !== 'object') throw new Error('A verified legacy catalog is required');
  const urls = db.prepare('SELECT url,note_id,source_path FROM legacy_urls ORDER BY url').all();
  const revision = db.prepare('SELECT r.headings FROM html_notes n JOIN content_revisions r ON r.id=n.draft_revision_id WHERE n.id=?');
  const rows = [];
  for (const item of urls) {
    const entry = catalog.entries[item.source_path];
    if (!entry || entry.oldUrl !== item.url || !Array.isArray(entry.headings)) throw new Error(`Catalog mismatch for ${item.source_path}`);
    const value = revision.get(item.note_id);
    if (!value) throw new Error(`Missing migrated article for ${item.source_path}`);
    const current = JSON.parse(value.headings), old = entry.headings;
    const offset = current.length - old.length;
    if (![0, 1].includes(offset)) throw new Error(`Heading count mismatch for ${item.source_path}`);
    const slugs = new Set();
    for (let index = 0; index < old.length; index++) {
      const before = old[index], after = current[index + offset];
      if (before.depth !== after.level || !before.slug || !/^section-\d+$/.test(after.id) || slugs.has(before.slug)) throw new Error(`Heading order mismatch for ${item.source_path}`);
      slugs.add(before.slug);
      rows.push({ noteId: item.note_id, oldSlug: before.slug, newId: after.id });
    }
  }
  return { urlCount: urls.length, anchorCount: rows.length, rows };
}

export function installLegacyAnchors(db, catalog) {
  const plan = planLegacyAnchors(db, catalog);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS legacy_anchor_maps (note_id TEXT NOT NULL,old_slug TEXT NOT NULL,new_id TEXT NOT NULL,PRIMARY KEY(note_id,old_slug))');
    const insert = db.prepare('INSERT INTO legacy_anchor_maps (note_id,old_slug,new_id) VALUES (?,?,?) ON CONFLICT(note_id,old_slug) DO UPDATE SET new_id=excluded.new_id');
    for (const row of plan.rows) insert.run(row.noteId, row.oldSlug, row.newId);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { urlCount: plan.urlCount, anchorCount: plan.anchorCount };
}
