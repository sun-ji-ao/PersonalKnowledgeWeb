# 显式隔离 HTML 写作台

在 `technical-notes-lab` 中执行以下 PowerShell 命令。选用全新的隔离目录；启用 HTML 模式必须显式指定 DATA_DIR，程序拒绝默认真实 data 目录及指向它的大小写/真实路径别名。

```powershell
npm.cmd run build:editor
$env:PORT='4314'
$env:HTML_EDITOR='1'
$env:DATA_DIR=Join-Path (Get-Location) '.test-data/my-html-trial'
$env:HTML_DB_PATH=Join-Path $env:DATA_DIR 'html-notes.sqlite'
$env:HTML_ARCHIVE_DIR=Join-Path $env:DATA_DIR 'html-archives'
$env:HTML_MEDIA_DIR=Join-Path $env:DATA_DIR 'media'
$env:SEED_DEMO='0'
node server.mjs
```

打开 `http://127.0.0.1:4314/admin/html`；站主密码保存在该隔离目录的 `admin-password.txt`。也可设置至少 12 个字符的 ADMIN_PASSWORD。关闭进程后重开保留 SQLite 修订与私有归档。停止试用后清除当前终端的 HTML_EDITOR/DATA_DIR/HTML_DB_PATH/HTML_ARCHIVE_DIR/HTML_MEDIA_DIR/PORT/SEED_DEMO 环境变量，避免影响后续命令。

备份上述试用目录时，在另一终端进入 `technical-notes-lab`，明确选择 HTML 库与原件目录。SQLite 备份可在服务运行中取得一致性快照；备份目标必须尚不存在。

```powershell
$trialDir=Join-Path (Get-Location) '.test-data/my-html-trial'
$backupDir=Join-Path (Get-Location) '.test-data/backups/my-html-trial-new'
node scripts/html-data.mjs backup $trialDir $backupDir --db (Join-Path $trialDir 'html-notes.sqlite') --archives (Join-Path $trialDir 'html-archives')
node scripts/html-data.mjs restore $backupDir (Join-Path (Get-Location) '.test-data/restored')
```

HTML 服务目录通常同时含旧接口的 `notes.sqlite` 和 HTML 库 `html-notes.sqlite`，不带参数的备份会因歧义拒绝执行。若服务配置了其他 `HTML_DB_PATH`/`HTML_ARCHIVE_DIR`，以上 `--db`/`--archives` 必须改为相同实际路径；CLI 不会隐式采用环境变量。可用 `--media` 指定附件目录，默认是 `$trialDir/media`。备份输出 `source` 字段可核对所选源。此命令备份 HTML 数据；如同目录旧 Markdown 库也有需要保留的内容，应另行备份该库。

迁移/联合恢复工具通常输出 `notes.sqlite` 和 `source-archives`，必须按恢复结果明确指定路径。假设已恢复到工作目录下 `.test-data/restored`：

```powershell
$env:HTML_EDITOR='1'
$env:PORT='4314'
$env:DATA_DIR=Join-Path (Get-Location) '.test-data/restored'
$env:HTML_DB_PATH=Join-Path $env:DATA_DIR 'notes.sqlite'
$env:HTML_ARCHIVE_DIR=Join-Path $env:DATA_DIR 'source-archives'
$env:HTML_MEDIA_DIR=Join-Path $env:DATA_DIR 'media'
$env:SEED_DEMO='0'
node server.mjs
```

这读取恢复出来的 HTML 修订，并保留同库旧字段作为兼容路径；启动不做正文迁移。目录中的原件不通过静态文件服务暴露。数据工具见 [HTML-DATA-GUIDE](./HTML-DATA-GUIDE.md)。

## 操作

第 6 批新增分类字段、正文下“图片与附件”上传区、逐项缺图补传与替换；公开首页可搜索/按分类和标签筛选，详情提供阅读工具，RSS/sitemap 仅含发布文章。上传限额、HTTP、媒体权限与备份命令详见 [媒体与搜索说明](./HTML-MEDIA-SEARCH-GUIDE.md)。浏览器验收仍待补，不把接口通过当作视觉检查。

新建可直接在正文区域输入，使用工具栏设置格式。代码可直接编辑，也可通过“编辑源码/语言”按钮调整；公式、图表、缺图和兼容块均有编辑按钮。保存状态显示在顶部。文章自动保存，也支持 Ctrl/⌘+S；编辑器仅保存 HTML，不反向生成 Markdown。

上传 Markdown 使用原始文件字节，文件名作为默认来源键；再次上传完全相同文件不会覆盖现有在线稿，同来源文件变化且已有在线编辑返回冲突。需要作为独立文章时使用独立来源键的 API 或不同文件名。frontmatter 的 draft:false 不会发布。

保存冲突时先点击“下载当前 HTML”保留本地正文，再点“重新打开服务器稿”。界面不会自动选择冲突胜者。历史区域点击刷新，可将任意修订恢复为新草稿。原件下载始终是导入时归档的文件，与在线修改后的 HTML 不同。

## HTTP 契约

以下接口均要求与旧写作台相同的登录会话；所有写操作校验 Origin。输入使用 camelCase，存储响应使用 snake_case。

| 接口 | 输入/输出 |
| --- | --- |
| GET `/api/html/notes` | 草稿列表元信息 |
| POST `/api/html/notes` | JSON `{title,description,category,tags,htmlSource}`，创建 HTML 草稿 |
| GET `/api/html/notes/:id` | 含 html_source、draft_revision_id、version、diagnostics 等 |
| PUT `/api/html/notes/:id` | JSON `{title,description,category,tags,htmlSource,version}`，版本不符 409 |
| POST `/api/html/import?filename=a.md&sourceKey=upload:a.md` | application/octet-stream 原字节；返回 `{note,unchanged,archive}` |
| GET `/api/html/notes/:id/history` | 该文章不可变修订 |
| POST `/api/html/notes/:id/restore` | JSON `{revisionId,version}`，创建新草稿修订 |
| POST `/api/html/normalize` | JSON `{htmlSource}`，规范化与诊断，辅助无损加载检查 |
| GET `/api/html/notes/:id/export` | 当前规范 HTML 私有下载 |
| GET `/api/html/archives/:id` | 私有原始字节下载 |
| POST `/api/html/notes/:id/publish` | JSON `{version,revisionId,sourceHash}`，以已保存稿发布；修订/版本变化 409，源或展示不合格 422 |
| POST `/api/html/notes/:id/unpublish` | JSON `{version}`，版本不符 409；撤回立即取消公开引用 |

发布与撤回都递增文章 version，客户端后续保存必须使用响应中的新版本。发布按钮先完成保存；草稿未通过展示校验时仍可保存，但发布被拒绝，旧公开版本保持不变。公开阅读按钮访问 `/notes/:id`。

显式 HTML 模式下匿名接口 `/api/public/notes`、`/api/public/notes/:id` 仅返回已发布展示 DTO；`/api/public/notes/:id/export` 下载已发布展示 HTML。未发布或撤回返回 404。导出是无脚本静态文档，公式用 MathML、图表保留 Mermaid 源码；图片及站内链接依赖原站在线，不是离线自包含附件包。公开页面使用原站 reader.js 实际绘图。

Markdown 上传上限 1,900,000 字节，规范 HTML 上限 11,400,000 字节；JSON 外壳接受最多 70,000,000 字节以容纳转义膨胀，正文仍受转换器较小上限限制。422 表示转换被拒绝，409 表示版本或来源冲突。展示失败不等于保存失败：有效源 HTML 仍可存为不可发布草稿，并返回诊断。
