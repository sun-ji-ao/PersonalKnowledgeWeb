import { parseFragment, serialize } from 'parse5';
import { inflateSync } from 'node:zlib';
import { privateRoot, writeArchive, readArchiveBytes } from './source-archive.mjs';
import { normalizeHtml, renderHtml } from './html-content.mjs';

export const MEDIA_LIMIT = 10 * 1024 * 1024;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status, code: 'MEDIA_INVALID' }); };
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
function walk(node, visit) { visit(node); for (const child of node.childNodes || []) walk(child, visit); }
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(bytes) { let n = 0xffffffff; for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
function dimensions(w, h) { if (!w || !h || w > 16384 || h > 16384 || w * h > 40_000_000) fail('图片尺寸超过限制'); }

// Detect bytes independently of filename and browser MIME. Only inert raster images
// are served inline; all non-image uploads are downloaded as octet-stream.
export function inspectMedia(bytes, filename = '') {
  const b = Buffer.from(bytes);
  if (!b.length || b.length > MEDIA_LIMIT) fail('文件须为 1 字节至 10 MiB', 413);
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let offset = 8, ihdr = false, end = false; const compressed = []; let maxDecoded = 0, layout;
    while (offset + 12 <= b.length) {
      const length = b.readUInt32BE(offset), type = b.toString('ascii', offset + 4, offset + 8);
      if (length > b.length - offset - 12) fail('PNG 数据不完整');
      if (crc32(b.subarray(offset + 4, offset + 8 + length)) !== b.readUInt32BE(offset + 8 + length)) fail('PNG 校验失败');
      if (!ihdr) {
        if (type !== 'IHDR' || length !== 13) fail('PNG 缺少头部');
        const w = b.readUInt32BE(offset + 8), h = b.readUInt32BE(offset + 12); dimensions(w, h);
        const depth = b[offset + 16], color = b[offset + 17];
        if (!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color] || []).includes(depth) || b[offset + 18] || b[offset + 19] || b[offset + 20] > 1) fail('PNG 格式不支持');
        layout = { w,h,depth,channels:({0:1,2:3,3:1,4:2,6:4})[color],interlace:b[offset + 20] };
        maxDecoded = Math.min(180_000_000, (w * 8 + 16) * (h + 16)); ihdr = true;
      } else if (type === 'IHDR') fail('PNG 重复头部');
      if (type === 'IDAT') compressed.push(b.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
      if (type === 'IEND') { if (length || offset !== b.length) fail('PNG 尾部不合法'); end = true; break; }
    }
    if (!end || !compressed.length) fail('PNG 数据不完整');
    try {
      const data = inflateSync(Buffer.concat(compressed), { maxOutputLength: maxDecoded }); let at = 0;
      const passes = layout.interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
      for (const [x,y,dx,dy] of passes) {
        const width = Math.max(0,Math.ceil((layout.w-x)/dx)), height = Math.max(0,Math.ceil((layout.h-y)/dy)); if (!width || !height) continue;
        const stride = Math.ceil(width * layout.channels * layout.depth / 8) + 1;
        for (let row = 0; row < height; row++) { if (at + stride > data.length || data[at] > 4) fail('PNG 扫描行不合法'); at += stride; }
      }
      if (at !== data.length) fail('PNG 像素长度不合法');
    } catch { fail('PNG 像素数据不合法'); }
    return { mime: 'image/png', kind: 'image' };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    if (b.length < 20 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) fail('JPEG 数据不完整');
    let pos = 2, frame = false, scan = false;
    while (pos + 4 <= b.length) {
      if (b[pos++] !== 0xff) fail('JPEG 标记不合法'); while (b[pos] === 0xff) pos++;
      const marker = b[pos++]; if (marker === 0xd9) break;
      const length = b.readUInt16BE(pos); if (length < 2 || pos + length > b.length) fail('JPEG 数据不完整');
      if ([0xc0,0xc1,0xc2].includes(marker)) { if (length < 8) fail('JPEG 头部不合法'); dimensions(b.readUInt16BE(pos + 5), b.readUInt16BE(pos + 3)); frame = true; }
      if (marker === 0xda) { scan = pos + length + 1 < b.length - 2; break; } pos += length;
    }
    if (!frame || !scan) fail('JPEG 缺少图像数据'); return { mime: 'image/jpeg', kind: 'image' };
  }
  if (b.subarray(0, 6).toString() === 'GIF87a' || b.subarray(0, 6).toString() === 'GIF89a') {
    if (b.length < 14 || b[b.length - 1] !== 0x3b) fail('GIF 数据不完整'); dimensions(b.readUInt16LE(6), b.readUInt16LE(8));
    let p = 13 + ((b[10] & 128) ? 3 * 2 ** ((b[10] & 7) + 1) : 0), frames = 0;
    const blocks = () => { let count = 0; while (p < b.length) { const n = b[p++]; if (!n) return count; if (p+n >= b.length) fail('GIF 子块不完整'); p += n; count += n; } fail('GIF 子块缺少终止符'); };
    while (p < b.length - 1) {
      const marker = b[p++];
      if (marker === 0x21) { if (p >= b.length) fail('GIF 扩展缺失'); p++; blocks(); }
      else if (marker === 0x2c) {
        if (p+9 >= b.length) fail('GIF 帧头不完整'); dimensions(b.readUInt16LE(p+4),b.readUInt16LE(p+6));
        const packed = b[p+8]; p += 9 + ((packed & 128) ? 3 * 2 ** ((packed & 7)+1) : 0);
        if (p >= b.length || b[p] < 2 || b[p] > 8) fail('GIF LZW 不合法'); p++; if (blocks() < 2) fail('GIF 帧数据为空'); frames++;
      } else fail('GIF 结构不合法');
    }
    if (!frames || p !== b.length-1) fail('GIF 没有完整图像帧');
    return { mime: 'image/gif', kind: 'image' };
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    if (b.length < 30 || b.readUInt32LE(4) + 8 !== b.length) fail('WebP 数据不完整');
    const type = b.toString('ascii', 12, 16); let w, h;
    if (type === 'VP8X') { w = b.readUIntLE(24, 3) + 1; h = b.readUIntLE(27, 3) + 1; }
    else if (type === 'VP8L' && b[20] === 0x2f) { const bits = b.readUInt32LE(21); w = (bits & 0x3fff) + 1; h = ((bits >>> 14) & 0x3fff) + 1; }
    else if (type === 'VP8 ' && b.subarray(23,26).equals(Buffer.from([0x9d,1,0x2a]))) { w = b.readUInt16LE(26) & 0x3fff; h = b.readUInt16LE(28) & 0x3fff; }
    else fail('WebP 图像头部不合法'); dimensions(w,h);
    let p = 12, image = false;
    while (p + 8 <= b.length) { const tag = b.toString('ascii',p,p+4), size = b.readUInt32LE(p+4); if (p+8+size > b.length) fail('WebP 数据块不完整'); if (['VP8 ','VP8L'].includes(tag) && size > 10) image = true; p += 8+size+(size%2); }
    if (!image || p !== b.length) fail('WebP 缺少图像数据（暂不支持动画）');
    return { mime: 'image/webp', kind: 'image' };
  }
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(filename)) fail('文件内容不是受支持的真实图片', 415);
  if (b.toString('ascii',0,5) === '%PDF-' && b.subarray(-1024).includes(Buffer.from('%%EOF'))) return { mime: 'application/pdf', kind: 'attachment' };
  if (b.subarray(0,4).equals(Buffer.from([0x50,0x4b,3,4])) && b.includes(Buffer.from([0x50,0x4b,5,6]))) return { mime: 'application/zip', kind: 'attachment' };
  try { const text = new TextDecoder('utf-8', { fatal: true }).decode(b); if (text.includes('\0')) throw new Error(); return { mime: 'text/plain', kind: 'attachment' }; } catch { fail('附件支持 UTF-8 文本、PDF 和 ZIP', 415); }
}

export function mediaReferences(html) {
  const references = [], missing = [];
  walk(parseFragment(html), node => {
    if (attr(node, 'data-note-kind') === 'missing-media') missing.push({ path: attr(node, 'data-note-path') || '', alt: (node.childNodes || []).map(n => n.value || '').join('') });
    const url = node.tagName === 'img' ? attr(node, 'src') : node.tagName === 'a' ? attr(node, 'href') : null;
    if (url?.startsWith('/media/')) references.push({ id: url.slice(7).split('#')[0], kind: node.tagName === 'img' ? 'image' : 'attachment', url });
  });
  return { references, missing };
}

export function createMediaManager(mediaDir) {
  const root = privateRoot(mediaDir); let db;
  const ensure = connection => {
    db = connection;
    db.exec(`CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, byte_length INTEGER NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, filename TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revision_media (revision_id TEXT NOT NULL REFERENCES content_revisions(id), media_id TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(revision_id,media_id,kind));
      CREATE INDEX IF NOT EXISTS revision_media_lookup ON revision_media(media_id,revision_id);`);
  };
  function record({ db: connection, revision }) {
    if (!db) ensure(connection);
    for (const ref of mediaReferences(revision.html_source).references) db.prepare('INSERT OR IGNORE INTO revision_media VALUES (?,?,?)').run(revision.id, ref.id, ref.kind);
  }
  function read(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail('媒体不存在',404);
    const metadata = db.prepare('SELECT * FROM media WHERE id=?').get(id); if (!metadata) fail('媒体不存在',404);
    let bytes; try { bytes = readArchiveBytes(root, id); } catch { fail('媒体文件缺失或校验失败',404); }
    if (bytes.length !== metadata.byte_length) fail('媒体文件长度异常',404);
    return { ...metadata, bytes };
  }
  return {
    mediaDir: root,
    attach(connection) { ensure(connection); for (const revision of db.prepare('SELECT id,html_source FROM content_revisions').all()) record({ db, revision }); },
    hooks: {
      onRevision: record,
      beforePublish({ revision }) {
        const refs = mediaReferences(revision.html_source);
        if (refs.missing.length) fail('请先补传缺失图片',422);
        for (const ref of refs.references) { const media = read(ref.id); if (ref.kind === 'image' && media.kind !== 'image') fail('图片引用不能指向附件',422); }
      },
    },
    upload(bytes, filename) {
      if (typeof filename !== 'string' || !filename || filename.length > 240 || /[\\/\r\n\0]/.test(filename)) fail('文件名不合法');
      const info = inspectMedia(bytes, filename), saved = writeArchive(root, bytes);
      db.prepare('INSERT OR IGNORE INTO media VALUES (?,?,?,?,?,?)').run(saved.sha256, saved.byte_length, info.mime, info.kind, filename, new Date().toISOString());
      return { id: saved.sha256, url: `/media/${saved.sha256}`, byte_length: saved.byte_length, ...info, filename };
    },
    read,
    publicRead(id) {
      if (!db.prepare(`SELECT 1 FROM revision_media rm JOIN html_notes n ON n.published_revision_id=rm.revision_id WHERE rm.media_id=? LIMIT 1`).get(id)) fail('媒体未公开',404);
      return read(id);
    },
    listFor(note) { const { references, missing } = mediaReferences(note.html_source); return { missing, references: references.map(ref => { try { const m = read(ref.id); return { ...ref, available: true, filename: m.filename }; } catch { return { ...ref, available: false }; } }) }; },
    async replace(store, id, input) {
      const note = store.get(id); if (!note) fail('笔记不存在',404);
      if (note.version !== input.version) throw Object.assign(new Error('草稿已变化，请重新加载'), { code: 'VERSION_CONFLICT', status:409, currentVersion:note.version });
      const media = read(input.mediaId), fragment = parseFragment(note.html_source); let count = 0;
      if ((typeof input.missingPath !== 'string') === (typeof input.oldMediaId !== 'string')) fail('请指定一项缺图路径或待替换媒体');
      walk(fragment, node => {
        if (typeof input.missingPath === 'string' && attr(node,'data-note-kind') === 'missing-media' && attr(node,'data-note-path') === input.missingPath) {
          if (media.kind !== 'image') fail('缺图必须补传图片');
          const alt = (node.childNodes || []).map(n => n.value || '').join('');
          node.nodeName = node.tagName = 'img'; node.attrs = [{name:'src',value:`/media/${media.id}`},{name:'alt',value:alt}]; node.childNodes = []; count++;
        } else if (typeof input.oldMediaId === 'string') {
          const attribute = node.tagName === 'img' ? node.attrs?.find(a => a.name === 'src') : node.tagName === 'a' ? node.attrs?.find(a => a.name === 'href') : null;
          if (attribute?.value === `/media/${input.oldMediaId}`) { if (node.tagName === 'img' && media.kind !== 'image') fail('图片不能替换为附件'); attribute.value = `/media/${media.id}`; count++; }
        }
      });
      if (!count) fail('当前草稿未引用此资源',404);
      const result = await renderHtml(await normalizeHtml(serialize(fragment)));
      return store.save(id, { version:input.version, title:note.title, description:note.description, tags:note.tags, category:note.category, result });
    },
  };
}
