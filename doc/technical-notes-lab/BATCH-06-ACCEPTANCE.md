# 第 6 批：媒体、分类、检索和阅读工具

> 2026-09-24 续记：下文保留交接时状态。用户随后明确授权浏览器连接器访问本机 4315，B6-07 已在隔离合成实例完成；见[第 5/6 批浏览器验收](./BATCH-05-06-BROWSER.md)。

日期：2026-09-23。状态：实现与针对性自动化完成；浏览器验收待补，不据此宣称第 5/6 批全部验收完成。默认真实库和 253 篇原始 Markdown 未在本批执行迁移。

## 交付

- `lib/html-media.mjs`：10 MiB 上传限制、真实字节格式检查、栅格图尺寸/PNG 解压预算、SHA-256 内容寻址、私有文件保存及哈希读取。图片为 PNG/JPEG/GIF/静态 WebP；附件接受 UTF-8 文本（包括作为下载文件的 HTML）、PDF、ZIP。SVG 不作为图片接受，动画 WebP 不支持。格式检查针对容器与结构，不声称具备杀毒或完整多媒体解码能力。
- `media/revision_media`：引用由规范源 HTML 提取，与新修订同事务写入。匿名 `/media/:hash` 必须能 JOIN 到至少一篇文章当前 `published_revision_id`；只有草稿/旧历史引用不放行，撤回即时拒绝。附件始终 octet-stream、attachment、nosniff，并设置禁脚本 sandbox CSP。
- 编辑器逐项列出缺图路径和当前媒体引用，可选择本地文件补传/替换；上传 API 从不按文章路径读取主机文件。补传使用 version CAS 新建草稿，历史与旧发布内容保持不变。通用文件上传会插入图片或附件链接，随后保存新修订。
- `category` 为独立修订字段，支持旧 HTML schema 增列默认空串、导入 category/categories、在线编辑、恢复与发布快照。标签筛选与分类筛选只看当前发布修订。
- `revision_search` 保存源 HTML AST 派生的纯文本，包含代码、LaTeX、Mermaid 源码；不重写正文。同事务写入修订派生记录，查询只 JOIN 当前发布引用。中文连续短语可跨行内标记匹配；空格分词为 AND，技术符号按字面查询，不解释 SQL/FTS 语法。
- 公开首页提供搜索/分类/标签，详情有目录、当前章节、高亮代码复制、阅读进度及图表放大/缩放；RSS 和 sitemap 仅枚举 published DTO，XML 转义。
- 联合备份包含媒体表全部已登记文件与修订引用；遗漏媒体目录、缺文件或哈希不符拒绝完成。恢复核验清单与数据库关联；未解析草稿/历史引用可原样保留，当前发布的失效引用拒绝恢复。

## 实际验证

| 检查 | 已执行结果 |
| --- | --- |
| `node --test --test-concurrency=1 test/html-features.test.mjs`（初版） | 5/5 通过 |
| features + public 发布回归 | 7/7 通过，约 13.6 秒 |
| 增加持久搜索/分类测试后的 features、editor、store 联跑 | features 6/6、store 8/8；editor mock 缺新媒体响应导致 1 项失败 |
| 修正 editor 测试 mock 后重跑 `node --test test/html-editor.test.mjs` | 3/3 通过，约 1.94 秒 |
| 第三代理独立 HTTP/升级/联合恢复与并发补图 | 4/4 通过；同版本双补传返回 200、409，见独立报告 |
| `npm run build:editor` | 成功；仅构建本应用 HTML 编辑器 bundle，未运行原站 build |
| 全套 `npm test` | 76/76 通过，0 失败/跳过，退出码 0，120.44 秒；见[实际输出](./batch-06/full-tests.txt) |
| 原文与源码对账 | 253 篇原文哈希不变；47 个最终源码文件与快照清单一致 |
| 4315 浏览器验收 | 未执行：自动审批拒绝新 origin 访问，保留待用户授权，不换工具绕过 |

合成实例使用 `technical-notes-lab/tmp/batch-06-browser`，端口 4315，tmp 已被忽略，不进入源码快照。浏览器记录由主代理维护 [第 5/6 批浏览器报告](./BATCH-05-06-BROWSER.md)。自动化用例使用明确临时目录并自行清理，不访问真实 data。

最终证据：[源码清单](./batch-06/source-manifest.json)、[源码快照](./batch-06/source-snapshot.zip)、[环境与结果](./batch-06/environment.json)、[收尾核验](./batch-06/closeout-check.json)、[独立集成报告](./BATCH-05-06-INTEGRATION.md)。快照 SHA-256：`fbdc2c814e8d0406f0748b0631b15bcca0ef950e8ad6a164fed108a8a759f87e`；不包含数据库、测试密码、依赖缓存或原文。

## 边界与下一步

搜索面向约数百篇的单作者笔记站，当前按发布时间输出、字面子串扫描，没有相关性排名、中文分词、分页或生产规模负载结论。派生纯文本可重建，源修订不会重转。外部 HTTPS 图片按浏览器访问，服务器不抓取或代理，也不能承诺外站永远可用。媒体无自动垃圾回收，以保留历史与联合恢复能力。

公开导出保持第 5 批的无脚本静态 HTML 方案，媒体需要原站在线，撤回后匿名无法读取。下一步先补浏览器操作验收，再进入第 7 批旧文/MVP 隔离迁移；正式域名、HTTPS、认证持久化与生产部署留第 8 批。
