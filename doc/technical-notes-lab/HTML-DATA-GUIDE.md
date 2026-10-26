# HTML 数据、原件、迁移与备份工具

命令在 technical-notes-lab 运行。写入命令指定尚不存在的隔离目录；CLI 禁止写入默认 data 及其子目录，源库只读打开。

```powershell
node scripts/html-data.mjs inspect data/notes.sqlite
node scripts/html-data.mjs backup data ../private-data/backup-new
node scripts/html-data.mjs restore ../private-data/backup-new ../private-data/restore-new
node scripts/html-data.mjs migrate ../fixtures/legacy/notes.sqlite ../private-data/migrated-new
```

`backup DATA_DIR NEW_BACKUP_DIR` 只在目录中恰好存在一种标准数据库时自动选择：`notes.sqlite` 配 `source-archives`，或 `html-notes.sqlite` 配 `html-archives`。同时存在两个数据库时会报歧义并退出，不生成备份。HTML 写作台通常同时建立这两个文件，因此须显式指定 HTML 数据库和归档路径：

```powershell
$trialDir=Join-Path (Get-Location) '.test-data/my-html-trial'
$backupDir=Join-Path (Get-Location) '.test-data/backups/my-html-trial-new'
node scripts/html-data.mjs backup $trialDir $backupDir --db (Join-Path $trialDir 'html-notes.sqlite') --archives (Join-Path $trialDir 'html-archives')
node scripts/html-data.mjs restore $backupDir (Join-Path (Get-Location) '.test-data/restored')
```

`--db` 与 `--archives` 必须成对提供；使用自定义 `HTML_DB_PATH`/`HTML_ARCHIVE_DIR` 时，将服务实际使用的路径传给这两个参数，CLI 不会自行读取这些环境变量。可另传 `--media MEDIA_DIR`，默认备份 `DATA_DIR/media`。成功输出的 `source` 字段列明本次实际选择的数据库、原件目录及媒体目录。一次联合备份包含所选数据库及其原件/指定媒体；同目录的旧 Markdown 库若也需要保留，须另行显式备份，不能把 HTML 库备份当成两个数据库都已备份。

迁移输出 notes.sqlite、source-archives、migration-report.json。每项为 migrated 或 legacy-fallback；有 fallback 时退出码 2，调用失败退出码 1。失败文章仍在副本旧 notes 表，没有半迁移 HTML 记录。报告不能代替人工及资源验收。

编辑器服务启用 HTML_EDITOR=1 后，将 HTML_DB_PATH 指向恢复/迁移目录 notes.sqlite，HTML_ARCHIVE_DIR 指向 source-archives，HTML_MEDIA_DIR 指向恢复结果 mediaDir；使用新端口和隔离 DATA_DIR。精确启动命令见写作台说明，媒体说明见 [第 6 批使用说明](./HTML-MEDIA-SEARCH-GUIDE.md)。

本页的 `migrate` 专门处理 MVP SQLite，原始旧文库应使用 [批迁移指南](./HTML-BATCH-MIGRATION-GUIDE.md)，两类来源独立计数。第 7 批已完成 253 篇旧文与 MVP 1 篇/2 修订的隔离迁移和联合恢复，实际目录见 [开发实现汇总](./DEVELOPMENT-IMPLEMENTATION-SUMMARY.md)。不要重复迁移来覆盖现有产物。

## 接口

`openHtmlStore(dbPath,{archiveDir,failpoint?,hooks?})` 显式初始化；只导入模块不升级库，不替代旧 openStore。同步 hooks 在修订写入、发布检查和发布引用变化的事务内调用，异常使事务回滚，供媒体和检索接入。

- create({result|convertedResult,title?,description?,category?,tags?,sourceMetadata?}) → note
- save(id,{version,result|convertedResult,...metadata}) → note
- get(id) → note|null，list() → note[]
- history(id) → revision[]，getRevision(id,revisionId) → revision|null
- restore(id,revisionId,version) → note；新修订继承目标元数据和原件，不改变发布引用。
- importSource({bytes,sourceKey,id?,filename?,result|convertedResult,...metadata}) → {note,unchanged,archive}；bytes 为原始 Uint8Array/Buffer；新来源可预分配 id，已有来源沿用原 id。
- readArchive(archiveId) → {bytes,filename,sha256,byte_length,...}；只供作者鉴权后下载。
- publish(id,version,{revisionId?,sourceHash?})、unpublish(id,version) 均校验版本并递增，鉴权发布 API 要求精确修订与哈希；第 5 批已接入。

result 来自 convertMarkdown/normalizeHtml，可经 renderHtml 加入展示字段。展示失败可保存有效草稿；发布要求 status=ready、renderStatus=ready、publishable=true、无阻止发布诊断且源哈希一致。

note 包含 id/version/draft_revision_id/published_revision_id/created_at/updated_at/published_at，以及草稿 html_source/html_rendered/source_hash/schema_version/versions/title/description/category/tags/source_metadata/status/render_status/publishable/diagnostics/headings/source_archive_id；published 是完整发布修订或 null。history 返回完整不可变 revision 数组（id 为修订 ID，note_id 为文章 ID），恢复增加 origin=restore 和 restored_from_revision_id。

HtmlStoreError 包含 code/status，冲突带 currentVersion：VERSION_CONFLICT/SOURCE_CONFLICT=409、NOT_FOUND=404、NOT_PUBLISHABLE=422、INVALID_CONTENT/INVALID_SOURCE/INVALID_METADATA=400。服务端必须先转换，不能直接存客户端声明的 result。

createJointBackup({dbPath,archiveDir,mediaDir?,destination}) 与 backupDatabase(dbPath,destination) 为异步函数；restoreJointBackup({backupDir,destination}) 同步返回 {directory,dbPath,archiveDir,mediaDir}。备份先获取一致性数据库快照再复制不可变原件与媒体；manifest 含大小和 SHA-256。有已登记媒体时 mediaDir 必须存在且全部文件哈希/长度正确。恢复拒绝覆盖和损坏/不完整/穿越 manifest，核对媒体表全部登记文件与当前发布引用。未知的草稿/历史缺图引用原样保留，不导致该库永远无法备份。

exportHtmlRollback(store,destination) 保存当前及历史 HTML 修订 JSON。原件/媒体必须联合备份；没有自动反转为旧 Markdown 库的模式。
