# 知页 · 动态技术笔记站

2026-09-28 备份续记：离机复制、校验、状态检查和保留预览工具已实现，Windows 每日 20:00 任务已注册；新计划首次自然触发待观察。详见 [备份自动化](./B9-BACKUP-AUTOMATION.md)。

独立的单作者技术笔记应用，使用 Node.js 24 与免费 SQLite。HTML 模式已实现 Markdown 原字节上传、可视化编辑、历史修订、发布/撤回、阅读、媒体、分类检索与联合备份；在 UCloud 动态服务内发布即时生效。生产站点现由 `https://sunjiao.me/` 提供，默认本地启动仍保留原 Markdown MVP。

截至 2026-09-27，第 7 批隔离迁移工程已将 253 篇旧文转换并修正两篇诊断。第 8 批在另一个预发布副本发布 253 篇、接入旧 URL/锚点；b9 在 UCloud 正式运行，阿里云 DNS、Nginx HTTPS 与证书模拟续期已通过。本地完整测试 **84/84 通过**，原修订库仍为 0 篇公开，原始 Markdown 未改。切换前联合备份的本机副本已按清单校验 254/254；作者侧真实内容/写作浏览器验收仍待确认。见[b9 部署状态](./B9-DEPLOYMENT-STATUS.md)与[第 8 批报告](./BATCH-08-ACCEPTANCE.md)。

完整状态见 [开发实现汇总](./DEVELOPMENT-IMPLEMENTATION-SUMMARY.md)、[任务清单](./TASKS.md)和[第 8 批报告](./BATCH-08-ACCEPTANCE.md)。文档集中在仓库根 doc/technical-notes-lab；下述命令在源码目录 technical-notes-lab 执行。

## 选择运行模式

| 模式 | 启动要求 | 阅读与写作 |
| --- | --- | --- |
| 默认 Markdown MVP | 不设 HTML_EDITOR；默认库为 `data/notes.sqlite` | `/` 阅读，`/write` 编辑 Markdown；保留旧功能回退路径 |
| 显式 HTML | `HTML_EDITOR=1`，必须设置隔离 DATA_DIR；可显式选择库、原件和媒体路径 | `/` 阅读发布 HTML，`/admin/html` 可视化编辑；默认真实 data 禁止写入 |

首次安装应用依赖后运行：

```powershell
cd C:\Users\17536\Desktop\website\technical-notes-lab
npm ci
npm start
```

以上是默认 MVP 启动，默认地址 `http://127.0.0.1:4310`。若已有同端口进程，不要覆盖或停止它；选择新的试用端口。HTML 新库和迁移/恢复库的完整命令见 [HTML 写作台指南](./HTML-EDITOR-GUIDE.md)。启动不会自动迁移文章。

首次启动在 DATA_DIR 下生成 admin-password.txt；可通过 ADMIN_PASSWORD 提供至少 12 字符的密码。会话为 HttpOnly、SameSite=Strict，保留 24 小时；HTML 模式会话与登录限流持久化，重启后仍有效。私有预览的 Host/Origin 只允许本机；正式模式还要求 HTTPS 公开 origin。`SEED_DEMO=0` 可关闭旧 MVP 示例种子。

常用环境变量：PORT、DATA_DIR、HTML_EDITOR、HTML_DB_PATH、HTML_ARCHIVE_DIR、HTML_MEDIA_DIR、ADMIN_PASSWORD、SEED_DEMO。使用后清除终端中的试用变量，避免后续命令写错库。

## HTML 日常流程

1. 在 `/admin/html` 新建笔记，或上传 .md/.markdown 原始字节。Markdown 转为 notes-html/1，原件私有归档；日常编辑以 HTML 为准。
2. 可视化编辑标题、摘要、分类、标签与正文。工具栏支持普通排版、代码、公式、Mermaid、表格和折叠；复杂节点保存源码。自动保存和 Ctrl/⌘+S 使用版本校验，两页冲突保留本地稿。
3. 图片与附件上传后可插入正文；缺图逐项补传或替换会产生新草稿，历史和旧发布快照保持不变。
4. 发布按钮先完成保存，再核对修订、哈希和源/展示诊断。另改草稿不会改变公开内容；再次发布才切换快照，撤回立即取消公开引用。
5. 公开首页支持分类、标签和中文/技术符号搜索；详情提供目录、阅读进度、代码复制与图表查看。RSS 为 `/rss.xml`，站点地图为 `/sitemap.xml`。新增阅读工具已在隔离实例完成浏览器交互验收。

导出分三类：作者当前规范 HTML、私有 Markdown 原件、公开已发布展示 HTML。公开导出为无脚本静态文档，公式用 MathML、Mermaid 保留源码，媒体仍需要原站在线，不是离线附件包。

支持结构、清洗规则和限额见 [正文规范](./HTML-SOURCE-SPEC.md)；上传类型、引用权限、补图和搜索细节见 [媒体与检索指南](./HTML-MEDIA-SEARCH-GUIDE.md)。

## 迁移与备份

第 7 批旧文修订库保留 253 篇未发布；第 8 批从其备份恢复的预发布副本有 253 篇已发布，后部署到 UCloud 正式站点。MVP 副本保留原发布引用，不能把两类来源合并计数。旧库与预发布副本不能混用。

- 旧文库：使用 [批迁移指南](./HTML-BATCH-MIGRATION-GUIDE.md) 的 catalog 与 html-batch-migrate.mjs，支持预分配 ID、旧 URL/锚点、资源映射、归档、resume、幂等和在线稿冲突保护。旧 URL 重定向现已在 UCloud 正式站点接通。
- MVP 数据库：使用 [数据指南](./HTML-DATA-GUIDE.md) 的 html-data.mjs migrate，在线备份到隔离副本后分别转换草稿与发布快照，原库只读。
- 预检查：使用 [转换指南](./CONVERSION-GUIDE.md)，只生成 HTML 和诊断报告，不写文章数据库。
- 联合备份：明确传入数据库、原件与媒体目录，备份目标必须尚不存在。双库同目录时工具拒绝猜测；不要仅复制写入中的 SQLite 主文件而遗漏 WAL、原件或媒体。

原 `npm run import` 仍是 **Markdown MVP 导入器**，没有新 HTML 来源幂等机制，不应当作上述 HTML 迁移入口。旧 catalog 脚本依赖原 Astro 项目现存缓存、生成稿及根 node_modules/devalue；单独对应用 npm ci 无法重建 catalog。b9 切换没有运行根 Astro build/import，也没有覆盖原始 Markdown。

## 验证与代码结构

```powershell
npm test
npm run build:editor
```

测试使用隔离临时库；后者只构建本应用 HTML 编辑器 bundle。第 8 批全套 83/83 通过，之前第 7 批的 82/82 结果见 [测试输出](./batch-07/full-tests.txt)与[收尾核验](./batch-07/closeout-check.json)。第 2/4 批已有各自浏览器记录，第 5/6 批补验见[浏览器记录](./BATCH-05-06-BROWSER.md)。

| 路径 | 职责 |
| --- | --- |
| server.mjs | HTTP、登录、模式切换、API 与静态资源 |
| lib/html-content.mjs、html-core.mjs、html-render.mjs | Worker 边界、规范转换、清洗与展示 |
| lib/html-store.mjs | 不可变修订、草稿/发布引用、CAS 和归档关联 |
| lib/html-media.mjs、html-discovery.mjs | 媒体及公开引用权限、检索、RSS/sitemap |
| lib/html-batch-migration.mjs、html-migration.mjs、html-backup.mjs | 旧文/MVP 独立迁移与联合恢复 |
| public/ | HTML 编辑模型/交互、阅读工具和样式 |
| lib/store.mjs、lib/content.mjs、public/editor.js | 保留的 Markdown MVP |

## 尚未完成

两篇迁移文章的 Mermaid 语法和代码语言标识问题已通过新的 HTML 修订修正；旧诊断见 [原始迁移报告](./BATCH-07-ACCEPTANCE.md)，新修订与待验范围见[内容续记](./BATCH-07-CONTENT-READING-ACCEPTANCE.md)。

第 5/6 批隔离 UI 验收完成。19 处外链涉及 12 个地址，已于 2026-09-24 逐一只读访问；253 个旧 URL 已在私有站运行时逐条验收，公网旧导航入口通过状态码检查。浏览器阅读为 5 篇代表文章抽样，不代表逐篇全文审校。

正式站点由 systemd 运行，证书 nginx HTTP-01 模拟续期成功；一份离机备份已按清单校验。仍待作者确认真实内容与写作体验、VPN 客户端/订阅/NewAPI 功能，并完善备份持续复制、保留和告警。当前无多用户权限、多人协作或生产负载结论；源码也尚未整理提交。服务器操作见[部署指南](./UBUNTU-DEPLOYMENT-GUIDE.md)与[当前状态](./B9-DEPLOYMENT-STATUS.md)。
