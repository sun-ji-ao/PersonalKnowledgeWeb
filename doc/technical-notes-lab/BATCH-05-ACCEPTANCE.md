# 第 5 批：HTML 发布与公开阅读

> 2026-09-24 续记：下文保留交接时状态。用户随后明确授权浏览器连接器访问本机 4315，B5-05 已在隔离合成实例完成；见[第 5/6 批浏览器验收](./BATCH-05-06-BROWSER.md)。

日期：2026-09-23。实现与针对性自动化已通过；本报告交接时浏览器及第 5/6 批完整回归由主代理继续执行，不提前计为完成。

## 交付

- `htmlStore.publicGet/publicList` 用 SQL 只关联 `published_revision_id`，公开白名单包含 id、revision_id、title、description、tags、headings、html_rendered、created_at、published_at，以及供第 6 批扩展的 category。没有 html_source、来源元数据、归档、草稿和历史字段。
- 发布核对全局 version、显式 revisionId/sourceHash、源 SHA-256、ready 状态、展示状态和阻断诊断。发布和撤回都在 BEGIN IMMEDIATE 中校验版本并递增 version；发布引用更新失败回滚。发布不生成正文修订，version 表示文章状态的并发令牌。
- 编辑器先完成保存，再以保存响应的修订、哈希及版本发布；响应回写本地版本。另改草稿、保存错误展示或发布被拒绝都不影响旧公开快照。
- 显式 `HTML_EDITOR=1` 下 `/`、`/notes/:id`、`/api/public/notes`、`/api/public/notes/:id` 和公开导出使用 HTML 快照。阅读路径不调用 Markdown 转换/渲染器。默认 Markdown MVP 路由保留。
- 私有当前 HTML、私有原始 Markdown 字节和公开展示 HTML 分开下载。公开 HTML 是无 JavaScript 的静态文档，内嵌基础样式，以 MathML 展示公式、以源码呈现 Mermaid；媒体与站内链接转成站点绝对地址，仍需要原站在线，撤回后私有媒体不可取。它不是离线自包含的图表/资源包。
- 第 6 批扩展通过同步事务钩子 `onRevision({db,note,revision})`、`beforePublish(...)` 和 `onPublishedChange({db,note,revision|null})` 接入媒体引用/校验。钩子抛错会回滚整个操作。INSERT 全部显式列名，允许修订表后续增加分类列。

## 已运行检查

工作目录均为 `technical-notes-lab`，数据为测试自行建立的临时隔离目录。

| 命令 | 实际结果 |
| --- | --- |
| `npm run build:editor` | 成功生成 bundle，esbuild 263 ms；普通沙箱父目录读取失败后，仅对本构建使用工具提权 |
| `node --test --test-concurrency=1 test/html-public.test.mjs` | 2/2 通过，0 失败，约 7.08 秒 |
| `node --test --test-concurrency=1 test/html-public.test.mjs test/html-editor.test.mjs test/html-store.test.mjs` | 13/13 通过，0 失败/跳过，约 18.89 秒 |

新增测试覆盖发布/撤回旧版本冲突、源哈希确认、事务扩展失败回滚、草稿和来源秘密不进入 DTO、HTTP 认证、目录/公式/代码/图表展示标记、错误 Mermaid 草稿不改变旧公开版本、公开导出隔离、重启后快照不变、重新发布和撤回立即不可见。存储基线测试由第三代理更新发布递增后的版本预期，保留原隔离断言。

测试初版 cleanup hook 先删除再关库导致 Windows EBUSY，已改成先关闭存储/测试进程再清理目录，最终上述检查退出码为 0；失败尝试不计通过。

## 尚待联合验收

- [ ] 浏览器：编辑器发布、另改草稿、更新发布、撤回和实际 Mermaid 绘图。
- [x] 第 5/6 批完整测试 76/76 通过，独立集成 4/4 通过；见[最终证据](./BATCH-06-ACCEPTANCE.md)与[独立报告](./BATCH-05-06-INTEGRATION.md)。
- [x] 原始 253 篇文件哈希最终对账，零变化。

CODE_RELEASED 已交第 6 批接入媒体、分类、搜索和阅读工具。未操作默认真实数据、原站 build、正式 253 篇迁移、部署、Git 提交或推送；没有关闭用户已有服务。
