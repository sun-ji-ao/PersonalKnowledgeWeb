# 第 3 批：HTML 修订、私有归档与隔离迁移验收

日期：2026-09-23。B3-01 至 B3-06 已完成针对性实现与隔离验收。编辑器接入属于第 4 批，公开 HTML 阅读切换属于第 5 批，253 篇旧文全量迁移属于第 7 批。没有修改或迁移默认真实库，没有改写原站 Markdown，没有运行原 Astro build/import。

## 交付

| 任务 | 实现及实际验证 |
| --- | --- |
| B3-01 | 默认 SQLite 以 readOnly 打开，integrity_check=ok；仅 notes 表、1 条旧笔记、0 条 HTML 笔记。SQLite 在线 backup API 成功备份运行中的库，不复制不一致的裸 WAL 文件，不停止原服务。 |
| B3-02 | html_notes 指向不可变 content_revisions；元信息、规范 HTML、展示 HTML、源哈希、工具版本、诊断和目录属于同一修订。数据库 trigger 拒绝改写历史；CAS 冲突拒绝覆盖；恢复创建新修订。 |
| B3-03 | 原字节 SHA-256、长度、展示文件名及来源类别入库。归档采用 hash.bin，临时写入/核验/原子重命名后才提交数据库引用；失败不留下悬空引用。事务失败产生的未引用原件保留，重试复用。 |
| B3-04 | 来源键和原字节哈希幂等，不重复文章/修订，不覆盖在线稿；变化源且已有在线修改则 SOURCE_CONFLICT。事务内二次检查幂等，转换 originalHash 存在时必须与原字节匹配。 |
| B3-05 | 先一致性复制源库到新隔离目录，再分别转换旧草稿和旧发布。旧 notes 字段保留；任一快照失败整篇 legacy-fallback。旧表没有发布来源元数据，发布修订明确标为不可恢复，不复用草稿 source_metadata。 |
| B3-06 | 联合备份 SQLite、引用原件和指定媒体；恢复验证路径、大小、哈希、库完整性和引用齐全，拒绝覆盖目标、损坏内容、缺失归档、穿越路径及符号链接。 |

文件：lib/html-store.mjs、lib/source-archive.mjs、lib/html-backup.mjs、lib/html-migration.mjs、scripts/html-data.mjs、test/html-store.test.mjs。没有修改 lib/store.mjs 的旧接口。接口和命令见 [数据工具说明](./HTML-DATA-GUIDE.md)。

## 测试证据

工作目录 technical-notes-lab，命令 `node --test --test-concurrency=1 test/html-store.test.mjs`。最后运行退出码 0：8 通过、0 失败/跳过，10,325.9964 ms。

覆盖不可变历史、元信息发布快照、草稿/发布分离、展示失败草稿保存与禁止发布、CAS 冲突、恢复新建修订、BOM/CRLF 原字节、幂等/在线稿冲突、原件哈希错配、恢复原件关联、归档写前/写后/事务失败注入、联合恢复及媒体字节、备份后新稿隔离、损坏拒绝、旧草稿/发布独立迁移、失败回退、发布不含草稿来源信息、Unicode 限额、默认 data 大小写保护、缺失归档、穿越路径和 Windows junction 拒绝。

测试写入均在系统临时目录，关闭数据库后清理自己的 fixture。完整跨批回归和浏览器编辑器证据由第 4 批及独立集成报告补充；不以这些测试宣称公开阅读已切换。

真实库一致性备份保留在本机临时私有目录 `C:\Users\17536\AppData\Local\Temp\notes-batch03-live-backup-6309f35a-cc8d-4a30-a274-729781b10322`。快照数据库 12,288 字节，SHA-256 `0898ba95515be41c1872a8582d11dae32b41b7cfd04cc627553c2e5354c09067`，manifest 时间 `2026-09-22T17:47:54.180Z`。实际恢复到另一临时目录 notes-batch03-live-restore-056a07d4-eeed-48f9-887b-b0193c55c250 后只读检查同样为 integrity=ok、1 条旧笔记、0 条 HTML。真实库及内容没有放进开发文档。

## 边界与后续

- POSIX 创建模式为目录 0700/原件 0600；Windows 沿用父目录 ACL，部署仍需限制数据目录账户权限。应用不公开归档目录，下载须作者认证；filename 仅供展示。
- 目前媒体没有并发写入服务；备份检查媒体复制前后哈希。第 6 批须采用不可变附件和修订引用，才能宣称动态媒体库完整一致性。
- 修订已有目录/诊断/工具版本；纯文本检索字段、media/revision_media、旧 URL 映射、持久化批任务队列留第 6/7 批。当前同步导入以来源键、事务和独立报告管理。
- exportHtmlRollback JSON 保留当前及历史 HTML 修订，但不包含原件/媒体字节；完整恢复须联合备份。不能直接换回旧库而丢弃新增 HTML 数据。
- 旧库仅能归档 Markdown 文本的 UTF-8 编码，标记 mvp-database-text，不声称恢复最初上传字节。
- 失败备份保留 .incomplete-* 目录供核查；未引用归档也保留，尚无自动垃圾回收。
- 存储接受服务端转换结果；HTTP 不得信任客户端 convertedResult/publishable。store 检查规范版本、源哈希及发布门槛；清洗/展示安全由共用转换器负责。
