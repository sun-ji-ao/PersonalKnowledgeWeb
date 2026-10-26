# 第 7 批：前六批补漏与迁移衔接

日期：2026-09-23。范围仅为既有发布、媒体、搜索、阅读、编辑及迁移接入；没有执行部署或浏览器验收。

## 核对与修复

依据 TASKS、DEV-LOG、HTML-SOURCE-SPEC、BATCH-05-06-INTEGRATION、BATCH-06-ACCEPTANCE，检查 HTML 公开 DTO/导出、服务路由、媒体引用权限、搜索派生索引、阅读工具和编辑器保存/重开流程。既有公开入口仍只使用当前发布引用；草稿修订、原件及撤回媒体没有新增匿名入口。

| 问题 | 修复与证据 |
| --- | --- |
| 搜索纯文本未分隔相邻表格单元格及折叠标题等结构，可能把两个单元格的“中文”“连续”拼成不存在的“中文连续” | `lib/html-discovery.mjs` 增补 th/td、summary/details、figure/figcaption、blockquote/hr 的文本边界；继续让 strong/em 等行内文本相连 |
| 仅修提取器不能修正已持久化的旧索引 | 新增 extractor_version=2，旧表自动增列；attach 仅从不可变源 HTML 重建缺失/旧版派生记录。schema 与索引重建同 SAVEPOINT，失败全部回滚；不调用转换器、不更改源正文/哈希/修订/发布引用 |
| 第 7 批两阶段文章链接需要预分配稳定文章 ID | 经迁移代理协调，`lib/html-store.mjs` 的 importSource 新来源允许 input.id；已有来源仍沿用 source.note_id。重复 ID 的数据库唯一约束拒绝事务，不覆盖其他来源 |

编辑器在途保存候选经入口等待与 inert 逻辑检查未确认缺陷，未无依据修改客户端。阅读工具的目录、复制、进度、图表查看仅核对代码连接，不能据此认定浏览器交互通过。

## 实际测试

工作目录 `technical-notes-lab`，全部使用测试自建临时数据。未执行根 Astro build/import，未读取或改写真实 data，未改动 253 篇原始 Markdown。

- 定向检查：`node --test --test-concurrency=1 --test-name-pattern='source update|search separates' test/html-store.test.mjs test/html-features.test.mjs`：2/2 通过，0 失败/跳过，退出码 0，2423.7186 ms。
- 模块回归：`node --test --test-concurrency=1 test/html-features.test.mjs test/html-store.test.mjs`：15/15 通过，0 失败/跳过，退出码 0，19979.3285 ms。
- 新测试实际模拟前批双列 revision_search 表，注入 UPDATE 失败，验证列升级与索引内容一起回滚；随后重试通过。修复前后私有 note 完整深比较相等（包含 html_source、source_hash、revision_id、published_revision_id），重启式重复 attach 不改变正文。跨单元格/summary 连续短语不再误命中，跨 strong 连续中文与分词 AND 仍命中。
- 稳定 ID 测试覆盖新来源预分配、同 ID 不同来源拒绝、既有来源重导忽略新传 ID；原件历史恢复测试继续通过。

本代理未重复全套测试；代码冻结后的全套回归与原文最终对账由主代理记录。

## 文件交接与限制

代码文件：`lib/html-discovery.mjs`、`lib/html-store.mjs`。测试文件：`test/html-features.test.mjs`、`test/html-store.test.mjs`。html-store 单点修改已经与迁移代理交接；没有修改 server、编辑器 bundle 或迁移代理新增模块。

第 5/6 批浏览器仍待验。4315 访问此前被自动审批拒绝，本轮没有明确补授权；没有调用浏览器，没有换端口或工具绕过，也没有将 HTTP/模型测试当作浏览器验收。生产性能、部署和正式切换不属于本次补漏结论。

## 第 7 批迁移独立复核（补充）

在迁移代理开发期间只读审查 `lib/html-batch-migration.mjs`、CLI、既有路径/原件/数据库模块及新增测试；问题交由迁移代理修改，未并发改写其文件。复核覆盖：输出隔离与符号链接、来源字节归档、旧元数据和 URL、恢复重跑、在线稿保护，以及旧文库与 MVP 数据独立计数。

本次独立审查提出并复核已修复：

- 初版 `legacy-*` ID 不匹配服务端 `[a-f0-9-]+` 路由。改为稳定十六进制 ID；最终迁移重新生成隔离目标，未沿用初跑的无效 ID。最终对账记录全部 253 个 ID 路由兼容。这是路由契约检查，不是浏览器验收。
- resume 目录内数据库或报告文件的符号链接可能绕过目录级隔离。现在读取 marker、打开数据库前递归拒绝符号链接和特殊文件；合成 junction 测试确认拒绝后未创建数据库。
- 异步建旧 URL 表原先由完成顺序决定碰撞赢家。现在预处理后统一检查同批重复 URL，所有参与者失败；同时检查已登记 legacy_urls 的 source_path，拒绝重跑把旧 URL 重绑另一来源。
- 目标文章入库失败的后处理最初只修改汇总报告，逐项 JSON 和可发布状态不一致。现在预先已知失败的目标在转换前阻断；后期失败时，仅为本轮新导入、且仍是该导入修订的可发布稿追加阻断修订，不改不可变历史。逐项报告在核验后重新输出。自动保护修订用 CAS 更新来源指针；两步之间崩溃的保守结果是后续变化源冲突，不会授权覆盖在线稿。
- 为避免上述保护逻辑误改用户在线稿，unchanged 返回的既有稿不执行自动追加。合成测试先由作者移除失效链接并保存，再 resume，确认在线 revision 与 publishable 不变。此时来源 Markdown 的迁移待办可能仍出现在报告中，不能将它误解为在线正文仍有该链接。

主代理另提出的 catalog 哈希核验、本地锚点、展示失败汇总已在最终实现中复核；没有重复执行其全量对账。实际证据采用迁移代理运行的 [migration-tests.txt](./batch-07/migration-tests.txt)：5/5 通过，0 失败/跳过，6697.0793 ms；本代理阅读测试实现和结果，未再次运行完整 suite。目标失败测试确认发布实际抛出 NOT_PUBLISHABLE，逐项 JSON 与返回报告完全一致。

最终 [迁移对账](./batch-07/migration-verification.json) 分别列明：旧文 253 篇、253 修订、253 幂等重复、253 原件与元数据核验、0 发布；MVP 1 篇、独立草稿/发布 2 修订。MVP 归档明确是数据库文本的 UTF-8 编码，不冒充最初上传字节。两套联合恢复分别 integrity=ok；这些数值为已读取的代理证据，主代理另有独立检查记录。

**规格符合性：通过本次隔离迁移与衔接的代码审查。代码质量：已发现的重要问题已修复，失败状态、不可变修订和在线稿边界有明确处理。可进入主代理最终回归和文档收尾。** 此结论不包含第 5/6 批浏览器、人工内容修复、旧站线上 URL 重定向部署或生产切换；来源缺图/错误公式图表仍按报告留待处理。旧 URL 表与文章链接映射属于迁移交付，不代表线上重定向已部署。
