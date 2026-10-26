# 第 2 批开发与验收报告

日期：2026-09-23。状态：**第 2 批验收完成**。转换代码、离线工具、自动化、源码对账和用户授权后的浏览器视觉检查均已完成，B2-01 至 B2-06 已勾选。1 篇旧文原有 Mermaid 错误仍明确阻止发布，不把它算作转换后可发布文章。未开始第 3 批数据库开发。

## 实现

| 模块（相对 technical-notes-lab） | 作用 |
| --- | --- |
| lib/html-content.mjs、html-worker.mjs | 公开异步 API，Worker 时间/内存边界；完成时等待线程退出，展示失败仍保留正文 |
| lib/html-core.mjs | 严格字节解码、YAML 元数据、Markdown→notes-html/1、parse5 AST 清洗、复杂节点源码、目录、诊断和哈希 |
| lib/html-render.mjs | 与源哈希绑定的 Shiki/KaTeX 展示生成、受控 SVG 校验、Mermaid 语法验证与浏览器源码容器 |
| lib/precheck.mjs、scripts/precheck.mjs | 单篇/目录/选择清单、媒体/文章映射、受限资源访问、逐项结果和汇总；不写数据库 |
| scripts/preview-conversion.mjs | 仅回环地址的本地预览和静态依赖服务 |
| scripts/audit-conversion.mjs | 原件哈希、复杂节点源码、规范化幂等与输出哈希对账 |
| test/html-content.test.mjs、test/precheck.test.mjs | 黄金样例、错误/攻击/边界、CLI 与函数一致性及审查回归 |

新增直接依赖 parse5 7.3.0（已有锁定传递依赖转为直接依赖）和 jsdom 26.1.0。Mermaid 含标签时需要 DOMPurify 的 DOM 支持，JSDOM 只在受限 Worker 中创建，不执行脚本或加载外部资源。安装锁文件已更新；npm 下载先被普通网络沙箱阻止，受审查的提升权限安装成功。未安装两个 Markdown skill 的运行脚本，没有调用第三方转换服务。

既有 server/store/editor/reader/import 工作流保持不变；网站仍使用 Markdown 保存与阅读。新增工具未连接默认 SQLite，未发布、未迁移、未推送代码。

## 自动化证据

- [最终测试输出](./batch-02/final-tests.txt)：24 通过、0 失败/跳过，约 51.33 秒，退出码 0。包括 15 个黄金样例、输入上限与超时、恶意 HTML、语言别名、两轮审查回归、展示生成、CLI 一致性及原 MVP 两项回归。
- [原文与现有运行时代码检查](./batch-02/unchanged-check.json)：253 篇原文均未改变；8 个已有读写/渲染/导入/回归文件与第 1 批基线一致。
- [旧文语义审计](./batch-02/legacy-audit.json)：10 篇、125 个代码块、31 个 Mermaid 源块逐项相同；原件哈希、规范化幂等、源 HTML 哈希通过。这 10 篇未含真正的数学公式节点。
- [专门样例审计](./batch-02/contract-audit.json)：1 个代码块、3 个公式和 1 个图表保留源码；另有缺失图片和旧链接样例。

测试文件按顺序执行，控制重量级 Worker 同时冷启动的资源竞争。曾在完整套件中观测到展示的 10 秒超时，串行执行也曾复现，单独及带前序输入的重现通常成功；没有证据认定是确定性数据问题。最终将展示冷启动预算独立设为 30 秒，转换仍为 10 秒，并等待 Worker 真正退出；1 毫秒强制超时测试继续验证保护和草稿保留。不能据此宣称已完成并发负载验收。Worker 的 256 MiB 是 V8 old-generation 配置，不是总 RSS 限制。

## 真实旧文抽样

样本清单见 [sample-selection.json](./batch-02/sample-selection.json)，最终输出见 [report.json](./batch-02/legacy-final/report.json)。选取长文、C/C++/汇编代码、表格及多张 Mermaid 图表，最长约 117 KB。每篇都有源 HTML、元数据与诊断记录。

| 结果 | 数量 | 解释 |
| --- | --- | --- |
| ready / 展示通过 | 9 | 通过程序转换、清洗和服务端展示校验 |
| review_required / 展示失败 | 1 | 原“内核态 Hook（Ring 0）”文章的 Mermaid 时序图语法报错，具体行及期望 token 在报告中；语义正文及图表源码完整保留，不允许发布 |
| rejected | 0 | 没有源文件解码或转换拒绝 |

`legacy-preview` 是第一次试跑记录：当时 DOM 环境尚未补齐，3 篇展示失败；它不是最终结论。最终结果以 `legacy-final` 为准。工具没有为使样例通过而修改原始图表代码。普通写作样例及缺图样例见 [contract-preview/report.json](./batch-02/contract-preview/report.json)：1 ready、1 review_required。

## 独立审查

使用 requesting-code-review 技能安排只读子代理审查，检查实际工作文件而不是尚未包含新站的 Git HEAD。发现并修复：列表间空白丢失、循环 YAML、未知行内 HTML 的非法嵌套/多次归一化、隐藏锚点、遗漏属性诊断、实体转义膨胀后无法重开、未报告的解析修复、目录混入删除文本、合法 KaTeX SVG 被拦截、展示超时返回丢失源正文。新增回归测试；最终针对修复的复查没有剩余重要问题。审查不替代浏览器或生产安全评估。

## 浏览器验收补充

首次访问曾被自动审批拒绝；随后用户明确授权浏览器连接器访问 4312/4313 并读取这 10 篇旧文及专门样例。授权后使用同一浏览器连接器完成检查，没有通过替代手段绕过先前拒绝。

逐篇查看截图并读取页面状态：9 篇正常展示，1 篇显示原始语法错误和源码回退；19 张旧文 SVG 绘制完成，3 个公式与 1 张专门流程图正常，折叠交互和缺图提示通过。桌面页面无整体横向溢出，长代码在框内滚动。详细观测值、范围和限制见 [浏览器验收记录](./batch-02/BROWSER-ACCEPTANCE.md)。操作说明见 [CONVERSION-GUIDE](./CONVERSION-GUIDE.md)。

下一批是 B3：SQLite HTML 修订模型、私有原字节归档、事务提交/幂等与冲突、旧草稿/发布快照分别迁移、联合备份恢复。此次不启动第 3 批。
