# 浏览器反馈：折叠正文交互修复

日期：2026-09-23。根代理实际浏览器发现，默认 ProseMirror details DOM 的 summary 点击未展开正文；源内容存在，但折叠状态始终关闭。

修复在编辑器的独立 details NodeView 中处理：打开文章时默认展开，点击直接 summary 显式切换 open；该点击由节点视图处理，避免 ProseMirror 阻止原生 summary 激活。open 属性变化被视为界面状态，既不生成编辑事务，也不序列化到 notes-html/1 正文。summary 与内部正文仍使用 contentDOM，允许正常编辑。

针对客户端测试新增真实 DOM 点击断言：初始展开→关闭→重新展开；折叠操作不触发保存；后续保存正文保持原始 `<details>`，不带 open 属性。`node --test test/html-editor.test.mjs` 3/3 通过，约 2.9 秒；输出在 [editor-tests.txt](./editor-tests.txt)。`npm.cmd run build:editor` 通过。

真实浏览器复验由根代理刷新后执行，结果记入其独占的 BATCH-04-BROWSER.md；本记录不代替浏览器验证。
