# HTML 媒体、搜索与阅读使用说明

仅适用于显式 `HTML_EDITOR=1` 模式。默认真实 data 继续保护，启动方法见 [写作台说明](./HTML-EDITOR-GUIDE.md)。数据库仍为免费 SQLite。

## 上传与补图

在写作台打开或新建笔记。正文下的“图片与附件”可选择文件并自动插入正文：PNG/JPEG/GIF/静态 WebP 插为图片，UTF-8 文本、PDF、ZIP 插为下载链接。单文件 1 字节至 10 MiB；图片单边最多 16,384 像素、总像素不超过 4,000 万，PNG 解压有额外上限。扩展名不能把 HTML 伪装成图片。SVG、动画 WebP 和未知二进制附件暂不支持。

导入 Markdown 后，本地相对图片会列成“缺失图片：原路径”。直接在对应行选择图片补传；不需要输入媒体编号。已有图片或附件可在对应行选新文件替换。补传/替换先保存当前编辑，然后带版本号创建新草稿；旧修订、旧发布图和最初上传 Markdown 原件都保留。两页同时补图时后提交者得到 409，应重新打开服务器稿后处理。

文件按 SHA-256 去重，默认保存在 `$DATA_DIR/media/<sha256>.bin`。可设 `HTML_MEDIA_DIR` 指向明确的隔离目录；不能指向受保护真实 data。上传完成不等于公开，匿名只可读取当前已发布正文实际引用的媒体。替换后必须更新发布，才会切换公开图；若没有其他文章引用，撤回后媒体立即返回 404。所有响应 no-store，不能撤销读者已下载到本地的副本。

## 分类与搜索

分类为独立输入框，最多 80 个 Unicode 字符，与标题/摘要/标签/正文同修订。导入优先使用 frontmatter `category`，否则 `categories` 字符串或数组首项；保留原始来源元数据。既有修订升级时分类为空，不原地改写历史。

首页搜索查已发布标题、摘要、分类、标签以及完整源正文的纯文本派生索引，支持连续中文、C++、`std::vector<T>`、代码和公式/图表源码。空格分隔的多个词需同时匹配，不使用正则、SQL或FTS查询语法。草稿、历史和原件不会进入公开结果。分类与标签可同时筛选。结果按发布时间排列；当前为数百篇小站实现，无相关性排序或大规模性能承诺。

详情页可点击目录跳转，滚动时显示当前章节与阅读进度；代码块提供复制，Mermaid 图表可放大并缩放，关闭按钮或 Escape 返回。RSS 入口 `/rss.xml`，站点地图 `/sitemap.xml`，均随发布/撤回即时变化。

## HTTP

| 路径 | 行为 |
| --- | --- |
| POST `/api/html/media?filename=文件名` | 登录及 Origin 校验；application/octet-stream 原始字节，返回 id/url/kind/mime |
| GET `/api/html/notes/:id/media` | 登录；当前草稿 missing 列表及 references 可用性 |
| POST `/api/html/notes/:id/media/replace` | 登录；JSON `{version,mediaId,missingPath}` 或 `{version,mediaId,oldMediaId}`；返回新草稿 |
| GET/HEAD `/media/:sha256` | 登录可查看私有文件；匿名必须存在当前发布引用。附件始终下载 |
| GET `/api/public/search?q=&category=&tag=` | 匿名；白名单结果、分类/标签 facets，仅发布数据 |
| GET `/rss.xml`、`/sitemap.xml` | 匿名 XML，只含发布文章 |

## 联合备份与恢复

```powershell
$trialDir=Join-Path (Get-Location) '.test-data/my-html-trial'
$backupDir=Join-Path (Get-Location) '.test-data/backups/media-snapshot-new'
node scripts/html-data.mjs backup $trialDir $backupDir --db (Join-Path $trialDir 'html-notes.sqlite') --archives (Join-Path $trialDir 'html-archives') --media (Join-Path $trialDir 'media')
node scripts/html-data.mjs restore $backupDir (Join-Path (Get-Location) '.test-data/media-restored')
```

如服务使用自定义 HTML_MEDIA_DIR，`--media` 必须与之对应；CLI 默认 `$trialDir/media`，不自动读取环境变量。恢复结果包含 dbPath、archiveDir、mediaDir。启动恢复副本时分别设置 HTML_DB_PATH、HTML_ARCHIVE_DIR、HTML_MEDIA_DIR，不要仅接数据库而忘记图片目录。已登记媒体的缺失/哈希错误会导致备份或恢复拒绝，不产生宣称完整的目标目录；`.incomplete-*` 是失败暂存证据。未知草稿或历史缺图仍可备份，供日后修复。

浏览器验收状态与限制见 [第 6 批报告](./BATCH-06-ACCEPTANCE.md)，不把接口测试当作浏览器点击验证。
