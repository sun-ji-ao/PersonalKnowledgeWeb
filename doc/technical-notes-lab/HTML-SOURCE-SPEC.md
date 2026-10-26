# 统一 HTML 正文规范 notes-html/1

日期：2026-09-23。状态：第 1 批确定契约，第 2 批独立转换/清洗和预检查完成，第 3 批独立 HTML 存储/归档及隔离迁移恢复完成；第 4 批显式隔离 HTML 编辑器、原字节上传和修订接口已通过自动化与浏览器验收。默认真实库未迁移。适用于旧文转换、上传 Markdown、在线 HTML 写作。变更本契约必须同步样例；破坏性变更升级规范版本，不静默重写旧修订。

当前 schema 为 notes-html/1，converter/sanitizer 为 2.0.0，renderer 为 2.0.1（Mermaid 11.16.1 安全补丁）。已有修订的版本字段保持原值，不随启动重转。

## 1. 正文与展示分离

`html_source` 是 UTF-8 HTML **片段**，只包含文章正文，是唯一可编辑真源。数据库修订同时记录 `schema_version: notes-html/1`、源 HTML SHA-256、转换器/清洗器/展示器版本和诊断。站点导航、文章元信息、主题 CSS、脚本不进入正文。

`html_rendered` 是绑定同一源修订的派生产物，允许受控高亮、KaTeX 和图表展示结构。不能把它反向当作源正文。展示失败不丢弃有效草稿，也不允许替换旧发布快照。标题、标签、目录、媒体引用和展示 HTML 必须与发布正文属于同一修订。

Markdown 原始字节单独私有归档；解析时移除开头 BOM，CRLF/CR 统一为 LF，禁止改写原件。严格 UTF-8 解码，非法字节拒绝，不用替换字符继续转换。不对文字、代码或 LaTeX 做 Unicode 归一化。转换入口接受字节，避免上传先 file.text() 导致原件失真。

## 2. 支持的 HTML 结构

| 元素 | 允许属性及约束 |
| --- | --- |
| p、br、hr、strong、em、del、blockquote | 无属性；内容遵守 HTML 块/行内结构 |
| h1–h6 | 仅 id；保留正文标题，包括与文章标题相同的 H1 |
| ul、ol、li | ol 可含正整数 start；li 可含 data-note-checked="true" 或 "false"，代表任务项；不存 input |
| a | href、title；危险 href 删除但保留文字并报告 |
| pre、code | 普通代码只用 pre > code；code 可含单个 language-* 类，行内 code 无类 |
| table、thead、tbody、tr、th、td | th/td 可含 data-note-align="left/center/right"；其他无属性；不支持合并单元格 |
| figure、figcaption、img | img 仅 src、alt、title；无属性 figure/figcaption；图片可直接置于段落中 |
| details、summary | 无属性；details 首个子元素必须是 summary；展开状态属于阅读 UI |
| span、div | 只允许下表定义的语义节点，不允许任意容器 |

保留合法嵌套列表、引用、表格和折叠正文。输出不允许任意 class、style、事件属性、脚本、表单、iframe、SVG、MathML、页面级 html/head/body、编辑器私有属性或任意 data-*。解析/清洗必须基于 HTML AST，不能靠正则表达式实现安全边界。

## 3. 复杂节点必须保留源码

| 类型 | 唯一规范表示 | 编辑与展示约束 |
| --- | --- | --- |
| 围栏代码 | `<pre><code class="language-cpp">已转义的源码</code></pre>` | code.textContent 是原文；不存高亮 span；没有语言用 language-text |
| 行内公式 | `<span data-note-kind="math-inline">x^2</span>` | 纯文本子节点保存 LaTeX；不含 `$` 分隔符 |
| 块级公式 | `<div data-note-kind="math-block">x^2 + y^2</div>` | 纯文本子节点；不含 `$$` 及分隔符紧邻的结构换行 |
| Mermaid | `<pre data-note-kind="mermaid"><code>flowchart LR\n A--&gt;B\n</code></pre>` | code.textContent 保留图表源码；编辑时不用 SVG 反推 |
| 缺失本地图片 | `<span data-note-kind="missing-media" data-note-path="./a.png">图片说明</span>` | 路径是转义文本，不是可访问 URL；补传后替换为 img |
| 不支持的安全结构 | `<pre data-note-kind="unsupported"><code>已转义的原始片段</code></pre>` | 只显示/编辑源码，必须先处理诊断才能发布，不能静默丢失 |

以上是完整属性白名单。语义节点不能嵌入活动 HTML；公式 div/span 只能含文本。编辑器必须识别所有语义节点，无法识别时阻止破坏性保存并允许下载/恢复，不能剥掉属性后保存。

代码别名沿用现有规则：c++→cpp、c#→csharp、js→javascript、ts→typescript、sh/shell→bash、cmd/batch→bat、assembly/x86/nasm→asm、ps1→powershell。规范语言名限小写 `[a-z0-9_-]{1,40}`。未知但合法的语言保留标识，展示退为纯文本并报 UNKNOWN_CODE_LANGUAGE；非法语言标识退为 text 并报诊断。围栏闭合前的内容保留一个结构末尾 LF，以及作者在内容中的空行；不 trim 代码。公式只去除解析器识别的分隔符，不折叠内部空格和换行。

## 4. 链接、标题与媒体

首次转换给所有 h1–h6 按文档顺序分配 `section-1` 等 ID，生成对应目录。在线保存保留已有合法唯一 ID（`[A-Za-z][A-Za-z0-9_-]{0,79}`）；新增标题使用未占用的下一编号。重复/非法 ID 重分配并报 ANCHOR_REASSIGNED。修改标题文字不改变其 ID；旧站锚点另外建映射，不假定编号与旧 URL 等价。

链接允许 http、https、mailto、`#合法ID` 和受管理的站内绝对路径。导入的相对文章路径通过传入的 articleMap 映射；无法映射则移除 href、保留文字并报 LINK_UNRESOLVED，阻止发布。失效的同文档锚点也报告。绝不按链接内容自动读取主机文件。

图片只允许 HTTPS 外部图片或受管理 `/media/<id>` 引用。导入相对图片经 mediaMap 转换；缺失时用 missing-media 节点并报 MISSING_MEDIA，阻止发布。data、blob、file、javascript、协议相对 URL 和任意主机绝对路径不进入 src/href。处理 HTML 实体和控制字符后再检查 URL 协议。外部图片不自动下载，访问性由后续媒体任务核验。

CLI 读取附件时限制在明确的导入根目录；路径穿越、编码穿越、Windows 盘符/UNC、符号链接逃逸均拒绝读取并报告 PATH_OUTSIDE_ROOT。只有 Markdown 的网页上传不能读取服务器本地附件。资源映射是纯转换函数的输入，文件访问属于受限入口层。

## 5. 元数据、清洗和错误

frontmatter 必须是有限大小的 YAML 对象；非法 YAML、非对象值、重复键、超限别名和未闭合 frontmatter 拒绝该项。来源元数据完整保留，标题优先级为 title → 第一 H1 → 文件名，标签按 tags → categories → category 取值。标题 200 字符、摘要 500 字符、标签 20 项为本版上限，超限显式报告而不是静默截断。frontmatter 中 draft:false 永远不能触发发布。

Markdown 内嵌 HTML 经 AST 解析后使用同一白名单。script/style/iframe/object/embed 及其内容删除；事件、危险 URL 属性删除；分别报告 UNSAFE_ELEMENT_REMOVED、UNSAFE_ATTRIBUTE_REMOVED、UNSAFE_URL_REMOVED。不支持但非活动的结构作为 unsupported 转义源码保留，报告 UNSUPPORTED_NODE。malformed HTML 必须报告修复或拒绝情况。安全删除仍算有损转换，报告不可省略。

转换接口已由 `technical-notes-lab/lib/html-content.mjs` 提供，均返回 Promise。以下为主要字段；实际结果还包含 sourceHash、固定版本信息和目录，Markdown 入口还返回 originalHash。工具版本由实现固定，调用方不能伪造版本号：

```text
convertMarkdown(bytes, { filename, mediaMap, articleMap })
normalizeHtml(html)
  → { schemaVersion, status, htmlSource|null, metadata, diagnostics[] }
diagnostic → { code, severity: info|warning|error, blocksPublishing,
               location: {line,column}|null, message }
```

- ready：源正文合法且没有阻止发布的诊断；仍需展示校验和显式发布。
- review_required：有效 HTML 草稿可保存，但存在缺失资源、有损清洗或不支持节点；不能直接发布。用户修复后重验，或显式接受可接受的内容删除并留下记录；活动代码永远不能恢复为可执行 HTML。
- rejected：解码、元数据、体积或结构处理失败；htmlSource 为 null，不创建文章修订，原件仍可保留在私有失败记录中。

Markdown 导入字节上限 1,900,000；规范 HTML 上限 11,400,000 字节，以容纳实体转义膨胀，使成功导入的内容仍可规范化和重开。超限报 INPUT_TOO_LARGE。AST 深度上限 64、节点数上限 50,000；转换、引用提取、规范化每次 Worker 调用最多 10 秒，展示最多 30 秒（含 Shiki/JSDOM/Mermaid 冷启动）；V8 old-generation 上限 256 MiB（不是整个进程 RSS 的硬上限）。超时/异常终止线程并返回诊断。单公式 10,000 字符，单 Mermaid 图表 50,000 字符；非法内容或生成失败禁止发布。阈值为保守初值，已测试近字节边界输入及约 117 KB 的真实长文，尚未做生产负载或编辑器性能验收。第 4 批另验证长文编辑体验。

`renderHtml(convertedResult)` 独立生成展示 HTML，返回 htmlRendered、renderStatus 和 publishable。发布必须同时满足源状态 ready、renderStatus=ready 且 publishable=true；源状态 ready 本身不代表图表/公式已经能展示。展示超时也保留原 htmlSource。Mermaid 在禁脚本/不加载外部资源的 JSDOM 中进行严格模式语法校验，保留转义源码容器供浏览器绘图；init 配置指令、YAML 配置头和 click 动作不支持。实际 SVG 绘制需要浏览器验收。KaTeX 合法 SVG 仅在受控展示产物中允许，源 HTML 的 SVG 仍禁止。

## 6. 规范化与验收约定

第 6 批实现补充：受管理媒体 ID 使用 64 位十六进制 SHA-256；HTML 源中的引用跟随修订，匿名放行只看当前发布引用。在线补图/替换创建 CAS 新草稿，不能原地改历史。category 为独立同修订元信息，最多 80 Unicode 字符，旧修订默认空；导入从来源 category 或 categories 首项初始化，原始 metadata/字节仍保留。此补充不改变 notes-html/1 正文序列化、转换器版本或已保存正文。

输出小写标签，属性按名称排序、双引号、文本转义 `&<>`，属性另转义双引号；空元素用 `<br>`/`<hr>`/`<img>`。结构节点之间不插入美化空白；段落文字、代码和复杂节点内部空白不能为美化而压缩。不自动给外链注入源属性，target/rel 等由展示器负责。

规范化必须幂等：N(N(html)) = N(html)。同一字节输入、资源映射和工具版本产生相同 htmlSource；哈希计算使用规范 UTF-8 字节。依赖版本变化先重跑样例，不在部署时重转全库。

机器可读黄金样例见 [cases.json](./batch-01/cases.json)，说明见 [样例验收](./batch-01/README.md)。第 1 批只检查完整性；第 2 批已增加真实转换的 HTML、元数据、诊断与幂等测试。第 4 批已通过“加载→修改普通文字→保存→重开”的模型及接口测试，比较复杂节点 textContent/语言/类型以及标题 ID，另验证 80 节长文与重叠保存。字符串相等不替代视觉核验；浏览器记录见 [第 4 批浏览器报告](./BATCH-04-BROWSER.md)。

第 4 批编辑器内部的段落包装、节点视图和属性仅用于 ProseMirror 模型，不写入规范源 HTML。无损加载检查允许 `em/strong` 等行内标记的等价嵌套顺序变化，但严格比较文本、块结构、链接属性、稳定 ID 和复杂节点源码。无法识别或存在其他语义变化时阻止加载保存，不静默剥离。HTML JSON 请求的传输上限 70,000,000 字节只容纳转义膨胀，不提高正文 11,400,000 字节限制。

第 2 批实现补充：循环/过度展开元数据拒绝；不支持的行内后代导致内容模型失效时，保留整个受影响的最小有效外层结构为兼容代码块，避免存入 pre 嵌套在标题或段落内的非法正文。目录从最终清洗结果提取。解析器忽略标签、重排内容、补闭合及移除属性均报告。HTML 阶段诊断无法可靠对应 Markdown 源位置时 location=null，不伪造行号；CLI 报告保留文件相对路径。
