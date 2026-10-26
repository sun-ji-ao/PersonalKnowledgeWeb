# 第 7 批：旧文与 MVP 隔离迁移验收

> 2026-09-24 续记：本报告保留第 7 批原始迁移时的诊断状态。两篇文章后来在新隔离库生成通过检查的 HTML 修订，恢复副本完成 5 篇代表文章浏览器阅读抽样；当前状态见[内容阅读续记](./BATCH-07-CONTENT-READING-ACCEPTANCE.md)。

日期：2026-09-23。本批完成隔离迁移、对账、原件归档、幂等冲突保护与联合恢复；没有修改 253 篇原文、原站生成稿或默认真实数据库，没有运行根 Astro build/import，没有部署和切换线上。用户本轮明确允许第 7 批独立工作；第 5/6 批浏览器验收仍未完成，4315 自动审批拒绝未绕过。

## 最终结果

| 来源 | 原始数量 | HTML 文章 | HTML 修订 | 失败/冲突 | 人工内容检查 | 公开状态 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 原始 Markdown | 253 | 253 | 253 | 0 / 0 | 2 | 全部草稿，0 公开 |
| MVP SQLite | 1 | 1 | 2 | 0 / 0 | 0 | 保留原发布引用；草稿与发布独立 |

两类来源不叠加计入 253。251 篇同时完成规范 HTML 和展示；另 1 篇 Mermaid 展示失败、1 篇代码语言标识需人工核对，都已保留 HTML 草稿与原字节来源，禁止发布。**迁移成功不代表所有文章可直接上线。**

最终私有库在 `technical-notes-lab/.test-data/batch-07-library-final` 和 `.test-data/batch-07-mvp`；两个库各自的 `-backup` 与 `-restored` 目录也在 `.test-data`。文档只保存对账数据，不保存完整正文或数据库。首轮 `.test-data/batch-07-library` 使用过不兼容 HTTP 路由的 `legacy-*` ID，已被最终纯 hex ID 新库取代，不应交付或用于后续工作；首轮 `migration-library.json`/`migration-catalog.json` 仅留历史检查证据，最终以带 `-final` 的报告为准。

## 来源、元数据与旧链接

- [最终 catalog](./batch-07/migration-catalog-final.json)：253 个真实旧 URL、旧标题锚点、生成稿哈希、原件哈希和完整旧站元数据。读取既有 Astro data-store 中的实际 `doc.id`，核对生成稿关键 frontmatter 与缓存一致，不执行旧生成脚本。
- [最终逐项迁移报告](./batch-07/migration-library-final.json)：253 个路径/来源键/原件哈希/新文章 ID/修订 ID/原件 ID及诊断。最终 253 个 ID 符合现有 HTTP 路由要求。
- 253 篇标题、摘要、分类、标签与 catalog 对账；旧日期、draft、order、useRealDate 等完整保存在 `source_metadata.legacySite`。旧来源 draft=false 不会触发自动发布。
- 253 个旧 URL 映射持久存入 `legacy_urls`；这是已核验映射，**尚未提供旧站 URL 的运行时重定向**。
- 对 253 份原始 Markdown 的 AST 与嵌入 HTML 引用收集器检测到 0 个图片引用、19 个外部链接、0 个内部链接。0 图片是该源集合的检测结果，不意味着替所有外网图片或文字形式路径完成验证；19 外链未请求网络，不声称可达。相对图片、缺图、跨文链接和旧锚点映射由合成测试覆盖。

## 必须保留的人工内容检查

| 原始路径 | 诊断与实际状态 | 后续处理 |
| --- | --- | --- |
| `15_HOOK专题/09_Windows 全架构 Hook 技术图谱-内核态 Hook（Ring 0）.md` | `RENDER_FAILED`，Mermaid 原始语法解析错误；HTML 源保留，展示失败，禁止发布 | 作者在 HTML 编辑器检查图表源语法，生成新修订并验证后发布；本批不擅改原件或技术内容 |
| `20_免杀专题/课时05_重写R3API.md` | `INVALID_CODE_LANGUAGE`，源位置第 54 行；代码原文按纯文本保留，需复核，禁止发布 | 作者核对围栏语言标识，在新修订中修正并重新验证；本批不执行代码 |

## 自动化与恢复证据

[迁移针对测试](./batch-07/migration-tests.txt) 5/5 通过：两阶段内部链接/旧锚点、分类元数据、缺图诊断、无效 UTF-8 归档、相同源幂等、变化源在线冲突、联合恢复、默认 data 拒绝、源目标隔离、输出 junction 拒绝、重复旧 URL/来源哈希拒绝、目标入库失败创建新阻断修订，以及 resume 不改作者在线稿。

[全量验证](./batch-07/migration-verification.json) 实测：

- 253/253 原件字节与源文件一致，253/253 旧站元数据一致。
- 253 次相同来源 importSource 返回 unchanged，修订数仍 253，文章仍 253，0 发布。
- 253 条旧 URL 映射；506 条原件登记分别用于独立来源清单和修订引用，底层内容寻址复用相同 253 份字节，不计作 506 篇文章。
- 两个隔离库分别联合备份与恢复，完整性均为 ok；旧文恢复 253 文章/253 修订，MVP 恢复 1 文章/2 修订。
- MVP 即使草稿文本与发布文本哈希相同，仍建立不同修订 ID，归档来源明确标注 SQLite 文本的 UTF-8 编码；没有把草稿当成发布快照。

根代理独立对账见 [independent-migration-check.json](./batch-07/independent-migration-check.json)：复核源哈希、归档字节、HTML 源哈希、元数据、旧 URL及全部草稿状态；MVP 副本旧 notes 全部字段与真实源 1 行一致。

根代理从联合恢复库实际启动隔离 HTTP 服务，鉴权打开纯 hex ID 文章返回 200 且草稿修订 ID 一致，作者列表 253；匿名私有接口 401，未发布文章 404，公开列表 0。服务已结束。见 [恢复库 HTTP 验证](./batch-07/restored-http-check.json)，这是接口验证，不代替浏览器验收。

最终全量完成后又加强了 URL 碰撞、resume 目录与在线稿保护、缺目标修订阻断等合成边界。最终 253 数据无内部链接/碰撞/恢复写入，未受这些后续边界修正影响，已对相应代码重新执行针对测试。无需反复转换全部文章来冒充新增数据验证。

## 交付与限制

主代理代码冻结后的完整 `npm test` 已通过：**82/82，0 失败/取消/跳过/todo，退出码 0，128808.3255 ms**。最终对账确认 253 篇原文和 281 个原站源码/生成稿/配置文件未变；52 个最终应用源码/测试文件与快照一致。证据：[测试输出](./batch-07/full-tests.txt)、[源码清单](./batch-07/source-manifest.json)、[源码快照](./batch-07/source-snapshot.zip)、[环境](./batch-07/environment.json)、[收尾核验](./batch-07/closeout-check.json)。快照 SHA-256：`095a3acaddeebe572d8f0377ec5c2616f54a983d12e593894dcdb044f1ff1126`。

本批隔离迁移工程验收完成，内容人工检查和浏览器待办仍保留。当前架构、实际能力、运行产物与后续事项已集中到 [开发实现汇总](./DEVELOPMENT-IMPLEMENTATION-SUMMARY.md)。

代码：`lib/html-batch-migration.mjs`，`scripts/html-batch-migrate.mjs`，`scripts/html-legacy-catalog.mjs`，`scripts/verify-batch-migration.mjs`，`test/html-batch-migration.test.mjs`。共享 store 增加新来源显式 ID 支持，已有来源仍沿用原 ID；搜索派生修复和回归由并行修复任务负责，其独立证据由共享收尾记录汇总。

运行命令、退出约定、恢复及冲突处理见 [迁移指南](./HTML-BATCH-MIGRATION-GUIDE.md)。本批不完成旧域名重定向、外链可达性检查、2 篇内容人工修正或浏览器检查，不代表第 8/9 批部署与全链路上线已通过。
