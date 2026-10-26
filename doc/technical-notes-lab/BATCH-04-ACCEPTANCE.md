# 第 4 批：原字节上传与 HTML 可视化编辑器

日期：2026-09-23。第 4 批验收完成：实现、完整回归、独立集成及真实浏览器交互均通过，详见 [浏览器报告](./BATCH-04-BROWSER.md)。默认 Markdown MVP 未迁移，第 4 批以显式隔离模式接入。

## 实现

- `/admin/html` 使用 ProseMirror 文档模型，正文在页面直接编辑；工具栏支持段落、标题、粗体、斜体、删除线、列表、引用、代码、公式、Mermaid、表格、折叠、链接、图片、撤销/重做。复杂节点提供专门源码编辑对话框；全文 HTML 下载是恢复手段，不是源码 textarea 编辑器。
- 自定义 schema 覆盖 notes-html/1，包括稳定标题 ID、任务列表属性、列表起始编号、单元格对齐、figure、details、缺失资源和 unsupported 兼容节点。代码保留语言与完整空白，公式显示 KaTeX 并保留 LaTeX，Mermaid 在编辑器显示可编辑源码块。
- 导入使用 `File.arrayBuffer()` 和 `application/octet-stream`；服务端统一转换，私有归档保留 BOM、CRLF 和原始字节。非法 UTF-8、转换拒绝和超限返回明确诊断，不创建覆盖稿。
- HTML 保存经服务端 normalize/render 后交给不可变修订存储，客户端无法提交可信 result。显示失败允许保存合法语义草稿，保留阻止发布诊断。
- 自动保存以本地 generation 和单一在途请求串行化；请求期间新编辑继续保留，下一次保存使用响应中的最新 version。409 后停止自动写入，保留编辑界面与 HTML 下载，重新打开服务器稿需要显式处理本地未保存修改。
- 切换笔记、新建、上传、退出与历史恢复先等待当前保存；失败阻止离开。历史恢复使用当前 version 创建新草稿，旧历史和发布引用由存储层保留。
- 打开前执行 schema 往返与独立 DOM 语义指纹检查。只允许行内标记顺序/相邻等价标记合并，其余文本、节点边界、属性差异都会阻止破坏性加载。未知节点不静默剥离。粘贴明确按纯文本处理；拖放被阻止并提示改用资源入口。

## 编辑器选择与许可

选择 ProseMirror 的理由是显式 schema、事务模型、选择映射与撤销历史可测试，能够给公式/图表/兼容块建立独立节点视图。没有把展示 DOM 反向当成正文，也没有采用无结构的 contenteditable 作为存储模型。

依赖按精确版本固定：prosemirror-model 1.25.4、state 1.4.4、view 1.41.3、commands 1.7.1、history 1.5.0、keymap 1.2.3、schema-list 1.5.1，均为 MIT；构建工具 esbuild 0.25.10（MIT）。浏览器 bundle 在本地生成，不依赖 CDN。分发许可保存在 `technical-notes-lab/public/html-editor.LICENSE.txt`；`npm.cmd run build:editor` 重建资源。

## 验证证据

| 检查 | 实际结果 |
| --- | --- |
| `node --test test/html-editor.test.mjs` | 3/3；DOM 语义等价正反例、80 节/80 代码块长文修改与重开、真实客户端重叠保存和冲突保留 |
| `node --test test/batch34-integration.test.mjs` | 独立代理 27/27；黄金与扩展 schema、原字节、CAS、历史恢复、匿名隔离、失败展示草稿、超旧 2 MB JSON 限制、联合恢复后继续编辑 |
| 备份 CLI 针对检查 | 2/2；两个库并存拒绝猜测，显式选择实际 HTML 库后恢复包含修订与原字节 |
| 原有/完整回归 | 最终 `npm test` 64/64，0 失败/跳过，退出码 0，126,363.4565 ms；包含旧 MVP、转换、安全、存储、编辑器、集成与 CLI |
| 浏览器真实交互 | 上传、新建/加粗、自动保存、代码源码、历史恢复、两页冲突、错误图表草稿、折叠内容编辑及 80 节长文重开通过 |
| 原文与文档 | 253 篇原文哈希不变；本轮文档本地链接核验通过，详情见 closeout-check.json |

原始编辑器测试输出见 [editor-tests.txt](./batch-04/editor-tests.txt)，跨批结果见 [独立集成报告](./BATCH-03-04-INTEGRATION.md)。长文测试包括规范化 Worker，总耗时约 1 秒（当前开发机器，非生产负载结论）。

完整输出见 [full-tests.txt](./batch-04/full-tests.txt)，只读原文及浏览器测试数据核验见 [closeout-check.json](./batch-04/closeout-check.json)。最终 38 个源码/配置/测试文件已保存 [清单](./batch-04/source-manifest.json)与[快照](./batch-04/source-snapshot.zip)，环境和 ZIP 哈希见 [environment.json](./batch-04/environment.json)；快照不含数据库、密码、缓存或 node_modules。

最终修复：备份 CLI 增加显式数据库/归档路径与多库歧义拒绝，避免备份错库；折叠正文使用编辑器 NodeView 展开和切换，展开状态不入库；测试数据目录加入 gitignore。Mermaid 从 11.16.0 最小升级至 11.16.1，renderer 记为 2.0.1，npm audit 当次结果为 0，详见 [补丁记录](./batch-04/MERMAID-SECURITY-PATCH.md)。原有修订不会被自动重转。

## 边界

HTML 发布/撤回/公开阅读切换仍属第 5 批，本批只有受保护的 HTML 草稿、原件下载与 HTML 导出。Markdown MVP 的旧接口和公开页面仍使用原模式。图片上传与媒体补传留给第 6 批；当前图片入口接受已有受管理资源或 HTTPS 地址。默认真实数据库与 253 篇原文件未通过本批入口写入，不部署、不提交 Git。

启动、API 和联合恢复后的精确配置见 [HTML 写作台说明](./HTML-EDITOR-GUIDE.md)。
