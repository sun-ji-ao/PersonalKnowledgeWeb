# 现有网站项目分析

分析日期：2026-09-22。范围：`C:/Users/17536/Desktop/website` 中已有项目，排除新建的 `technical-notes-lab`。本报告只分析内容网站的软件系统，不改写任何技术文章。

## 结论

现有项目已经是有较完整阅读体验的技术知识库，但核心架构是「本地 Markdown → 批量导入 → 构建全部页面 → 静态部署」。代码高亮和 Mermaid 已具备；数学公式、浏览器上传 Markdown、在线写作及持久化后台均没有实现。对于用户更看重写作体验、希望发布不依赖静态构建的目标，仅补几个页面无法解决，需要建立新的内容存储和写作发布链路。

推荐保留现有站点作为迁移期间的可回退版本，新建动态应用承接写作发布，并复用已有 Markdown、图片、分类信息及阅读界面设计。若希望保留 Astro，也可以将其改成动态前台并接入后台；这是可行的架构重构，不是框架自身不支持动态，而是本项目目前没有相关基础。最终是否采用新方案，应结合子代理 2 的实际交付及子代理 3 的验证决定。

## 调查方法和验证边界

- 使用 `gitnexus-exploring` 技能的架构分析方法。当前没有可调用的 GitNexus 工具，因此没有绑定索引或声称索引最新，全部结论来自本地源码、依赖及独立渲染探针。
- 根代理已检查到工作目录的祖先路径没有 `AGENTS.md`；本代理在现有项目内的搜索也未发现适用的嵌套 `AGENTS.md`。
- 统计到源 Markdown 253 篇，生成后的 Markdown 253 篇，20 个一级内容专题。生成 Markdown 总体积约 3.35 MB，其中 4 篇包含 Mermaid 围栏。
- `node --check` 检查导入脚本、Mermaid remark 插件和阅读增强脚本，均通过。
- 使用已安装的 `@astrojs/markdown-remark` 与项目相同的 remark/Shiki 配置，独立渲染代码、公式、Mermaid 样本：代码生成带颜色的 Shiki HTML；Mermaid 生成 `.mermaid` 容器；`$x^2$` 和 `$$ E=mc^2 $$` 保留为普通文字，没有公式排版。
- 未运行 `npm run import` 或 `npm run build`：导入脚本会删除并重建生成目录、图片目录，并写回日期元数据，不属于只读验证。未运行网站全文构建或部署。
- 根代理尝试本地开发服务器：关闭 Astro 遥测后仍出现 `Dev server failed to start within 30s`，浏览器连接被拒绝。本次未完成原站浏览器验收，不能仅凭此判定原项目代码不可运行。页面体验判断来自源码，Mermaid 的浏览器绘图效果尚未实测。

## 架构与真实发布流程

```text
bypassAV-study-main/ 或 CONTENT_SOURCE_DIR
             ↓ scripts/import_markdown.mjs
src/content/docs/ + public/imported-images/ + content_dates.json
             ↓ Astro Content Collections / getPublishedDocs
Astro 页面、Shiki、Mermaid 容器、RSS、Sitemap
             ↓ astro build
dist/ 静态站点
             ↓ pagefind --site dist
静态全文搜索索引
             ↓ GitHub Actions / Pages
公开网站
```

关键证据：

- [package.json:7](C:/Users/17536/Desktop/website/package.json:7)：开发、导入、构建、预览命令；第 9 行将导入、Astro 构建和 Pagefind 串联。
- [src/content.config.ts:4](C:/Users/17536/Desktop/website/src/content.config.ts:4)：`glob` 只读取 `src/content/docs/**/*.md`，没有数据库或远程 CMS loader。
- [src/pages/docs/[...slug].astro:7](C:/Users/17536/Desktop/website/src/pages/docs/[...slug].astro:7)：文章通过 `getStaticPaths()` 枚举并生成，正文使用 `render(doc)`。
- [.github/workflows/deploy.yml:25](C:/Users/17536/Desktop/website/.github/workflows/deploy.yml:25)：CI 安装 Node 22、执行 `npm ci` 和 `npm run build`，随后上传 `dist`，使用 GitHub Pages 部署。

当前发布一篇文章需要把文件放进本地源目录，导入预览，提交可用内容并触发构建部署。站点里没有可接收文件的服务端接口，也没有「在网页写作 → 保存草稿 → 发布」链路。RSS 等 `.ts` 文件的 `GET` 是静态输出端点，不能据此认为已有运行时内容后台。

## 对用户需求的满足情况

| 用户需求 | 现状 | 证据或缺口 |
| --- | --- | --- |
| 纯记录、分享技术长文 | 已具备 | 专题、列表、详情、标签、归档、分页、RSS，内容以 Markdown 文章为中心 |
| Markdown 写作 | 部分具备 | 可以在本地编辑源文件，但网站本身没有编辑器 |
| 直接上传 Markdown | 未具备 | 只有命令行批量导入，没有 file input、上传 API 或上传后的元数据确认 |
| 在线写作 | 未具备 | 没有 textarea/contenteditable 编辑界面、保存接口、自动保存或版本历史 |
| 代码高亮 | 已具备并通过渲染探针 | [astro.config.mjs:8](C:/Users/17536/Desktop/website/astro.config.mjs:8) 配置 Shiki `github-dark` |
| 数学公式 | 未具备并通过探针确认 | Markdown 配置没有数学插件，行内/块公式原样输出 |
| 图表 | 已实现 Mermaid 接入，浏览器效果未实测 | [src/lib/remark-mermaid.mjs:6](C:/Users/17536/Desktop/website/src/lib/remark-mermaid.mjs:6)、[src/lib/mermaid-client.ts:45](C:/Users/17536/Desktop/website/src/lib/mermaid-client.ts:45)；数据统计图表编辑器未发现 |
| 草稿与发布 | 仅有文件规则式草稿排除 | [src/content.config.ts:13](C:/Users/17536/Desktop/website/src/content.config.ts:13) 和 [src/lib/content.ts:452](C:/Users/17536/Desktop/website/src/lib/content.ts:452)，不是作者后台 |
| 发布后即时可读 | 不具备 | 必须经过导入、构建和部署 |
| 不依赖静态站点生成 | 不满足当前偏好 | 当前内容存储、页面路由、搜索及部署都围绕静态构建 |

长文阅读方面值得保留的实现包括：H2–H4 目录、上一篇/下一篇、阅读进度、回到顶部、代码复制、深浅主题、响应式样式。证据分别为 [文章模板:24](C:/Users/17536/Desktop/website/src/pages/docs/[...slug].astro:24)、[public/reading-enhance.js:5](C:/Users/17536/Desktop/website/public/reading-enhance.js:5)、[public/theme-toggle.js:7](C:/Users/17536/Desktop/website/public/theme-toggle.js:7)、[global.css:1700](C:/Users/17536/Desktop/website/src/styles/global.css:1700)、[global.css:2075](C:/Users/17536/Desktop/website/src/styles/global.css:2075)。

搜索已接入 Pagefind 正文检索；开发环境加载不到索引时仅回退到标题、描述、分类、标签过滤，不是全文搜索。证据：[src/pages/search/index.astro:83](C:/Users/17536/Desktop/website/src/pages/search/index.astro:83) 和第 101 行。

## 影响改造路线的关键问题

### 1. 生成目录不能作为在线写作的持久化存储

[scripts/import_markdown.mjs:423](C:/Users/17536/Desktop/website/scripts/import_markdown.mjs:423) 在每次导入时清空 `src/content/docs` 和 `public/imported-images`；第 450 行重写全部文章，生成 Markdown 目录也被 [.gitignore:6](C:/Users/17536/Desktop/website/.gitignore:6) 忽略。若后台仅把新文章保存进生成目录，下一次构建就可能丢失这些文章。必须确定唯一内容来源，动态后台应拥有独立持久化存储，旧导入器只能作为一次性迁移工具。

### 2. 导入流程会改写作者表达与元数据

[scripts/import_markdown.mjs:341](C:/Users/17536/Desktop/website/scripts/import_markdown.mjs:341) 会剥离原 frontmatter、删除开头一级标题、为 H2–H4 自动编号、规范化代码围栏并改写图片路径。第 431–450 行根据路径和文件名推导标题、分类、标签，重新生成 frontmatter。

这适合原有按课时组织的文档批量整理，但通用技术写作需要保留用户手写的标题、标签、摘要、日期和草稿状态。尤其源文件中的 `draft: true` 不会自动保留，实际草稿由 [content_rules.json](C:/Users/17536/Desktop/website/content_rules.json) 与导入器第 129 行的匹配规则决定。迁移时要显式确认状态，不可仅相信源 frontmatter 已经控制公开可见性。

### 3. 日期有历史展示逻辑，迁移不能当成真实发布时间

[src/lib/content.ts:59](C:/Users/17536/Desktop/website/src/lib/content.ts:59) 为历史文档在 2021-11-01 至 2025-10-31 范围内分配展示日期；[第 434 行](C:/Users/17536/Desktop/website/src/lib/content.ts:434) 将它与新文档的真实日期合并。该复杂算法与课程排序耦合，不宜整体迁入一般笔记应用。

导入器 [第 382 行](C:/Users/17536/Desktop/website/scripts/import_markdown.mjs:382) 发现已有日期条目就直接返回，内容修改不会自动更新 `updated`。新系统应分开保存实际创建时间、实际更新时间、首次发布时间，以及必要时单独保留的历史展示日期；不能把生成的展示日期伪装成原始创作时间。

另一个现有细节：[rss.xml.ts:13](C:/Users/17536/Desktop/website/src/pages/rss.xml.ts:13) 对按分类/课时排序的文档取末尾 50 篇再反转，并非严格按发布日期选择最新 50 篇。迁移 RSS 时应修正此行为。

### 4. 在线导入会改变 Markdown 的信任边界

现有 remark 插件在 [src/lib/remark-mermaid.mjs:14](C:/Users/17536/Desktop/website/src/lib/remark-mermaid.mjs:14) 直接将 Mermaid 源码插入 HTML 字符串，客户端又在 [src/lib/mermaid-client.ts:40](C:/Users/17536/Desktop/website/src/lib/mermaid-client.ts:40) 使用 `securityLevel: 'loose'`。独立探针确认 Mermaid 标签中的 `<b>` 被原样保留到输出 HTML。

把当前实现扩展成浏览器上传/预览时，应使用纯文本 Mermaid 容器、安全配置与 HTML 清洗，并让预览与发布使用一致的渲染规则。新后台同时需要作者登录、草稿隔离与服务端参数验证；目前没有这些实现。

### 5. 图片迁移需按真实文件映射校验

当前导入器 [第 213 行](C:/Users/17536/Desktop/website/scripts/import_markdown.mjs:213) 复制相对引用的图片并改写地址。它将图片按 Markdown 所在目录和图片 basename 存放，因此同目录文章引用不同子目录的同名图片存在覆盖可能。第 453–457 行还会在源根 `images/` 存在时清空前面生成的图片目录后重新复制；本次源根没有 `images/`，因此这段分支当前未触发，不应报告为已出现的数据损失。

迁移应保留正文原始相对路径的解析上下文，生成稳定媒体 ID/地址，并列出缺失图片。只上传单个 `.md` 不会自动带上本地图片，应在新界面明确支持另传图片，或后续支持目录/ZIP 导入。

## 可复用资产与改造代价

| 资产或模块 | 复用方式 | 工作量判断 |
| --- | --- | --- |
| 253 篇原始 Markdown | 保留原文；离线迁移进草稿或按确认规则发布 | 中：必须核对标题、日期、状态、图片及内部链接 |
| 分类、标签、课时顺序 | 抽取映射，保留专题顺序但不强制新文章按课时命名 | 小至中 |
| 图片、favicon、OG 图 | 复制到新媒体系统/静态资源目录，建立路径映射 | 中 |
| 阅读排版、目录、导航、主题、复制按钮 | 复用视觉样式和行为设计，按新模板适配 | 小至中 |
| Shiki / Mermaid 渲染思路 | 重建统一的预览/发布渲染管线，补数学和内容清洗 | 中 |
| SEO、RSS、站点地图 | 复用字段与 URL 设计，改为动态读取已发布文章 | 中 |
| 文件夹导入器 | 只复用语言映射/路径识别等函数，拆出一次性迁移工具 | 中；原脚本不应直接变成在线 API |
| Astro Content Collections、getStaticPaths、Pagefind 构建、Pages 部署 | 若改为动态发布，需替换或重大改造 | 大，覆盖核心数据流 |
| 在线编辑、自动保存、登录、草稿发布、版本记录、备份 | 当前没有可复用实现 | 大，是此次主要新增开发工作 |

这些为相对工作量，不是未经排期的工时承诺。小规模单作者应用可以使用轻量动态服务与数据库，不需要多用户 CMS、微服务或复杂审批。

## 两条路线比较与建议

| 路线 | 能保留什么 | 主要新增/替换 | 适用条件 |
| --- | --- | --- | --- |
| 在原仓库把 Astro 改成动态站点并增加后台 | 现有阅读组件和样式 | 运行时适配、数据库、编辑器、上传发布、动态搜索、部署方式、移除破坏性构建导入 | 对原 UI 依赖强，愿意承担同一项目内跨层改造和回归验证 |
| 在独立目录开发动态技术笔记应用，再迁移内容 | 原始文章、媒体、分类、URL、阅读设计 | 构建独立内容服务和写作体验，完成一次性迁移和重定向 | 用户重点是写作发布体验，希望原站保留回退能力 |

就本次偏好而言，建议第二条：以独立动态应用验证完整写作链路，再迁移原内容。不要因为已有阅读页面可用，就把在线写作强行接到会被每次构建覆盖的生成目录。也不必推翻已有内容和阅读设计；它们是新应用最有价值的资产。

进入正式切换前的最低验收：登录作者可新建并保存草稿；刷新/重启后草稿还在；公开页面和搜索不可见草稿；Markdown 上传保留正文及可识别元数据；代码、行内/块公式、Mermaid 在预览和发布后均正确；发布无需重建全站；修改、导出、备份恢复可用；迁移数量、旧 URL、图片引用有校验记录。新方案若仅完成空壳 UI 或计划文档，应继续实现验证，不能据此声称已经可替代原站。
