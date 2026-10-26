# 旧文库隔离迁移工具

在 `technical-notes-lab` 目录运行，Node.js 24。工具只转换本地文件内容，不执行文章中的命令、示例或代码，不获取外部 URL。所有目标必须与源目录分离，默认 `data` 禁止写入。不得用这里的命令替代正式切换审批。

catalog 脚本另有旧站依赖：它读取原 Astro 项目的 `.astro/data-store.json`、已有生成稿与原件，并静态导入仓库根 `node_modules/devalue/index.js`。这些现存缓存和依赖必须可用；只在独立应用目录执行 `npm ci` 不会提供根 devalue，也不能重建旧 catalog。迁移正文模块使用应用自身依赖。不要运行根 Astro build/import 来替代此只读 catalog 流程；缓存缺失或不一致时应先核对来源，不能把猜测 URL 当作已验证 catalog。

先从现存 Astro 缓存读取真实文章 ID，并对照生成稿 frontmatter，再按原始 Markdown 的原字节迁移：

```powershell
node scripts/html-legacy-catalog.mjs .. .test-data/catalog-new.json
node scripts/html-batch-migrate.mjs ../bypassAV-study-main .test-data/library-new --catalog .test-data/catalog-new.json --report .test-data/library-report-new.json
```

目录及报告文件应使用新名字；catalog 输出的父目录必须已经存在。catalog 工具只读取 `.astro/data-store.json`、`src/content/docs` 与 `bypassAV-study-main`，不运行原站 import/build。旧 URL 来自缓存的实际 `doc.id` 和原站 `getDocUrl`，并非凭文件名猜测。生成稿元数据关键字段若与缓存不同则拒绝生成，原文哈希在实际迁移时再次检查。catalog 保存标题、摘要、分类、标签及全部旧站元信息；日期、order、draft、useRealDate 等记录在修订 `source_metadata.legacySite`，不把占位日期冒充真实发表日期，也不因原站 draft=false 自动发布。

`migrateMarkdownLibrary` 使用共享有界转换器，三路 worker。先建立完整来源、稳定纯十六进制 ID、旧 URL 和锚点映射，再导入正文和本地资源。资源只能来自原件根目录内，经真实路径检查后按字节类型验证并存入私有媒体目录；外部地址仅记录，不下载。每条链接/图片都有映射或明确未解决状态。持久 `legacy_urls` 是核验映射表，**尚未接服务器旧 URL 重定向**。

所有可读取且不超过大小限制的原件先按原字节归档和登记，即使后续 UTF-8/转换/元数据拒绝也保留来源；超限或读取失败条目会报告失败，源文件保留原位置。正常导入另登记修订所引用的原件，因此归档记录数不等于来源文件数；内容寻址文件按哈希复用。

输出包含 `notes.sqlite`、`source-archives`、`media`、`batch-source.json`、逐项 `item-ID.json` 和带时间戳的总报告。JSON 报告包含路径、原始哈希、来源 ID、HTML 修订/原件 ID、元数据、媒体和链接映射、诊断。原始 Markdown 仍不改动，HTML 草稿成为编辑内容。

失败后允许显式恢复同一受管理隔离目录：

```powershell
node scripts/html-batch-migrate.mjs ../bypassAV-study-main .test-data/library-new --catalog .test-data/catalog-new.json --resume --report .test-data/library-resume-report-new.json
```

恢复检查来源根及输出树，拒绝符号链接/junction 和特殊文件。相同源哈希返回 unchanged，不覆盖在线稿；同源变化且已有在线修改返回 SOURCE_CONFLICT。更新 catalog 时必须重新核验原件哈希。重复旧 URL 的所有参与项均拒绝；已登记旧 URL 不得被别的来源占用。

内部链接的目标最终入库失败时，工具对本轮仍由它持有的迁移草稿新增阻断发布修订，保留旧修订；不修改 unchanged 的在线稿。系统阻断修订随后以 CAS 更新来源指针；若恰在两步之间崩溃，下一次变化源将保守地报冲突，须核对历史后人工处理，不会覆盖在线内容。逐项和总报告一致，但无法将迁移报告当成外部 URL 可达性证明。

CLI 返回约定：0 为无待处理项；2 为存在失败、冲突或人工检查项；1 为调用/基础设施错误。`reviewRequired` 包括展示失败及阻止发布诊断，不能只按 HTML 已入库判断完成。

MVP 数据库必须独立迁移和计数：

```powershell
node scripts/html-data.mjs migrate data/notes.sqlite .test-data/mvp-new
node scripts/verify-batch-migration.mjs ../bypassAV-study-main .test-data/library-new .test-data/mvp-new .test-data/catalog-new.json .test-data/verification-new.json
```

MVP 源库只读打开，通过 SQLite online backup 建立一致性副本后才增加 HTML 表；当前草稿与旧发布快照各自转换，保留旧表全部字段。MVP 原件是数据库文本的 UTF-8 编码，不能声称是最初上传文件的原字节。验证脚本对旧文逐项核对归档、元数据、纯 hex 路由 ID和 253 次幂等导入，并为两个隔离库分别生成 `-backup`、`-restored` 目录及完整性验证。所有这些目录必须尚不存在。

联合恢复包含来源归档、媒体和迁移映射表；使用恢复库继续编辑的运行参数见 [HTML 数据指南](./HTML-DATA-GUIDE.md)。第 8 批已将 253 条旧 URL 与 4,410 条锚点映射接入私有 HTML 服务，并在 UCloud 回环预览逐条核验；公开 GitHub Pages 尚未切换。B5/B6 浏览器验收已单独完成，见[浏览器记录](./BATCH-05-06-BROWSER.md)。正式公开发布的当前边界见[第 8 批报告](./BATCH-08-ACCEPTANCE.md)。
