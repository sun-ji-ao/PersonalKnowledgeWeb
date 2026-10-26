# 第 1 批验收报告

日期：2026-09-23。结论：**第 1 批范围验收通过**。现有 Markdown MVP 基线验证通过，HTML 正文契约和转换预期样例已建立。HTML 转换器、数据库新模型与可视化编辑器尚未实现。

## 代码核对

| 当前文件（相对新站源码目录） | 已有行为 | 后续改造位置 |
| --- | --- | --- |
| lib/store.mjs | SQLite 保存 markdown/published_markdown，版本号控制保存；发布复制字段形成快照 | 第 3 批改为不可变 HTML 修订及草稿/发布引用，保留冲突与隔离约束 |
| lib/content.mjs | BOM/frontmatter 处理；remark、Shiki、KaTeX 生成展示 HTML；原生 HTML 被省略 | 第 2 批分离语义源与展示；内嵌 HTML 清洗、有损诊断、严格解码 |
| scripts/import.mjs | 递归读 Markdown，直接创建草稿；相同文件重复运行会再次创建 | 第 2 批另建只读预检查；第 3 批来源归档、哈希去重和事务导入 |
| server.mjs | 上传接收 Markdown 字符串；阅读时实时渲染发布 Markdown | 第 4 批上传字节归档和 HTML 保存；第 5 批读发布 HTML |
| public/editor.js、lib/views.mjs | textarea Markdown 写作，自动保存/预览；冲突提示 | 第 4 批 HTML 可视化编辑和复杂节点往返 |
| public/reader.js | 本地 Mermaid 严格模式渲染，失败回退 | 第 2 批定义源/展示结果，第 5 批接入受控展示与失败状态 |
| test/workflow.test.mjs | 2 组 Markdown/HTTP 工作流测试，使用隔离临时数据库 | 保留回归，并随各批增加真实转换、存储和浏览器验收 |

原站是仓库根目录下的 Astro 项目。本批未运行会重新生成内容的原站构建/导入命令，也未修改新站运行时代码、锁文件和默认数据配置。

## 实际运行证据

运行环境：Node v24.15.0、npm 11.12.1；捕获时间与源码基准见 [environment.json](./batch-01/environment.json)。Git HEAD 为 f189dae2d6dc768ec8f89f68a3f70f45c5e683ba，新站尚未纳入此提交，因此另外保存了可核验的源码 ZIP。

| 检查 | 本次结果 | 证据 |
| --- | --- | --- |
| 在 technical-notes-lab 运行 `npm.cmd test` | 2 项通过、0 失败/跳过，约 2.31 秒；进程退出码 0 | [测试日志](./batch-01/baseline-test.txt) |
| 新站源码 SHA-256 与 ZIP 逐文件比对 | 14 个文件一致；快照含 .gitignore、锁文件和测试，不含私密数据 | [基线检查](./batch-01/baseline-check.txt)、[源清单](./batch-01/source-manifest.json) |
| Node 语法检查 | 8 个 JS/MJS 文件通过 | [检查脚本](./batch-01/check-baseline.ps1)及基线检查日志 |
| 原始 Markdown 哈希与数量对账 | 253 篇完全一致 | [旧文清单](./batch-01/protected-manifest.json)及基线检查日志 |
| 黄金样例完整性 | 15 项通过；预期为 ready 10、review_required 3、rejected 2 | [样例日志](./batch-01/fixture-check.txt)；这是样例状态分布，不是转换结果 |

原有端到端回归实际验证了：未登录写接口被拒绝、错误密码/跨站来源被拒绝、上传始终草稿、旧版本保存/发布冲突、新草稿不泄露到公开页和公开导出、重启持久化、来源元数据导出、撤回和退出登录。测试未驱动浏览器，因此不把自动保存 UI、长文性能或新 HTML 编辑体验记为通过。

默认 SQLite 被已有进程占用，尝试只读文件哈希未成功；随后没有停进程或复制活动数据库。该项不属于本批通过项。测试源码确认使用随机临时 DATA_DIR；本批源码快照不能替代数据备份，联合备份恢复留到第 3 批。

## 交付与验收边界

- [TASKS](./TASKS.md) 和 [DEV-LOG](./DEV-LOG.md)：本批状态、依赖、下一批任务和执行记录。
- [HTML-SOURCE-SPEC](./HTML-SOURCE-SPEC.md)：notes-html/1 白名单、源码节点、清洗、资源、确定性、状态及接口契约。
- [15 项黄金样例](./batch-01/cases.json)：正常转换、有损清洗、缺失资源与拒绝场景的明确预期；附 [使用和扩展要求](./batch-01/README.md)。
- PLAN、HTML 设计、文档索引已统一批次顺序，去掉“第 1 批已能复杂节点往返”的歧义。

本批以规范和证据为交付。没有把现有 renderMarkdown 输出存成 HTML 真源，没有实际批量迁移或更换数据库字段。新清洗器安全、实际转换一致性、编辑器往返、长文性能和恢复演练均需后续实际测试。

## 下一批入口

按 [TASKS 的 B2-01 至 B2-06](./TASKS.md) 开始：先实现共享结果契约和严格输入校验，再实现 Markdown→语义 HTML 与 HTML 规范化/清洗，独立生成展示，最后接本地预检查 CLI 和约 10 篇真实样本。先通过黄金样例及恶意输入测试，再进入第 3 批数据库存储。第 2 批输出到隔离检查目录，不写文章数据库。
