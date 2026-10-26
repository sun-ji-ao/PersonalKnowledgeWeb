# 第 2 批转换工具使用说明

当前工具生成可检查的 HTML 和报告，不写文章数据库，不替换线上 Markdown MVP。最新结果见 [第 2 批报告](./BATCH-02-ACCEPTANCE.md)。命令默认在 `C:\Users\17536\Desktop\website\technical-notes-lab` 运行。

## 单篇、目录与抽样

```powershell
# 查看参数
npm.cmd run precheck -- --help

# 整个源目录预检查；输出目录必须尚不存在，父目录必须已存在
npm.cmd run precheck -- --input ../bypassAV-study-main --output ../review-output/html-check-new

# 单篇（请换成真实路径）；root 定义可读取附件的唯一边界
npm.cmd run precheck -- --input "../bypassAV-study-main/某目录/某文章.md" --root ../bypassAV-study-main --output ../review-output/single-check-new

# 重现本批选定的 10 篇；选择一个新的输出目录名
npm.cmd run precheck -- --input ../bypassAV-study-main --select ../doc/technical-notes-lab/batch-02/sample-selection.json --output ../review-output/sample-check-new
```

退出码：0 表示全部源/展示检查可用；2 表示存在待处理/拒绝项，仍应打开 report.json 查看原因；1 表示参数、输出目录或运行错误。不能把退出码 2 当成没有输出。相同目录重复运行会拒绝覆盖；该工具不是数据库幂等导入器，来源去重和在线编辑冲突已由 HTML store 实现，批量持久化请使用 [第 7 批迁移工具](./HTML-BATCH-MIGRATION-GUIDE.md)。

输出目录不得位于导入根内，也不能是导入根的祖先。目录扫描跳过符号链接并报告；显式资源解析还核验真实路径。路径穿越、编码穿越、盘符、UNC、符号链接逃逸不能读取。图片仅复制导入根内、10 MB 以内且文件头为 PNG/JPEG/GIF/WebP 的文件，以内容哈希命名；不下载外部图片。原 Markdown 不被改写或在此阶段建立正式归档。

`--maps mapping.json` 可提供 mediaMap/articleMap 对象，将原引用映射至受管理 URL。`--select selection.json` 接受相对导入根的路径数组。默认跨文章映射只针对本次选中的文章；旧标题锚点的全站映射仍留到正式迁移，未解决的链接有明确诊断。预览 ID 使用相对路径哈希，不能当作未来数据库 ID。

## 输出与预览

每个成功转换项生成 `.source.html`、逐项 `.json`；展示通过才生成 `.rendered.html`。`report.json` 汇总所有输入的状态、耗时、源哈希、诊断以及媒体映射。单项 JSON 另含元数据、语义 HTML、目录、工具版本、资源映射和展示结果。原始源码和这些检查输出都应按私有开发资料处理。

```powershell
# 本批旧文预览
npm.cmd run preview:conversion -- --report ../doc/technical-notes-lab/batch-02/legacy-final --port 4312

# 专门的公式/图表/缺图验收样例
npm.cmd run preview:conversion -- --report ../doc/technical-notes-lab/batch-02/contract-preview --port 4313
```

服务器仅绑定 127.0.0.1。手动访问对应端口检查标题、长代码、表格、公式、图表和诊断；Ctrl+C 停止。预览是开发工具，无数据库连接，也没有发布操作。Mermaid 浏览器脚本和 KaTeX 字体来自本地依赖。此服务器只应用于本工具生成且可信的报告目录，不能作为公共站点部署。

## 作为共享模块使用

```javascript
import { convertMarkdown, normalizeHtml, renderHtml } from './lib/html-content.mjs';
const converted = await convertMarkdown(bytes, {
  filename: 'note.md', mediaMap: {}, articleMap: {}
});
if (converted.htmlSource !== null) {
  const checked = await normalizeHtml(converted.htmlSource);
  const display = await renderHtml(converted);
  // 此示例只作转换检查；持久化由 HTML store 接入。发布必须检查 display.publishable。
}
```

使用公开的 Worker 包装模块；不要从请求处理器直接调用 `html-core.mjs`，否则会绕开同步解析任务的超时边界。单篇函数没有文件/网络读取，资源映射和文件访问属于 CLI 入口层。归档原字节及 SQLite 提交已在 HTML store 和上传/迁移入口实现；此预检查 CLI 本身不写库，参见 [数据指南](./HTML-DATA-GUIDE.md)与[批迁移指南](./HTML-BATCH-MIGRATION-GUIDE.md)。

## 验证

```powershell
npm.cmd test
node scripts/audit-conversion.mjs --root ../bypassAV-study-main --report ../doc/technical-notes-lab/batch-02/legacy-final --output ../review-output/new-semantic-audit.json
```

语义审计检查原文件哈希、代码/公式/Mermaid 源文本、规范化幂等和源 HTML 哈希，不等同于浏览器视觉验收。输出审计文件也必须尚不存在。
