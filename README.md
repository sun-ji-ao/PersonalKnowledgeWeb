# 孙计奥 Notes — 个人技术知识网站

基于 [Astro](https://astro.build/) 的静态知识库站点，将本地 Markdown 技术文档自动导入、构建为可浏览、可搜索的个人网站。内容涵盖 Windows 内核、C/C++、逆向工程、安全研究等主题。

**在线地址：** https://sun-ji-ao.github.io

## 功能特性

- **Markdown 文档导入** — 从外部 Markdown 目录批量导入，自动生成 frontmatter、分类与标签
- **代码高亮** — 基于 Shiki（`github-dark` 主题）渲染代码块
- **全文搜索** — 构建时由 [Pagefind](https://pagefind.app/) 生成站内搜索索引
- **分类与标签** — 按目录自动分类，按关键词推断标签，支持独立列表页与详情页
- **RSS 订阅** — `/rss.xml` 输出最近 50 篇文档
- **站点地图** — `/sitemap.xml` 包含首页、分类、标签及全部文档链接
- **纯静态部署** — 无需后端，适合 GitHub Pages / Cloudflare Pages

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 网站框架 | Astro |
| 内容管理 | Astro Content Collections |
| 代码高亮 | Shiki |
| 站内搜索 | Pagefind |
| 语言 | TypeScript |
| 部署 | GitHub Pages / Cloudflare Pages |

## 项目结构

```text
website/
├── astro.config.mjs          # Astro 配置（站点 URL、Markdown 主题）
├── package.json
├── scripts/
│   └── import_markdown.mjs   # Markdown 导入与规范化脚本
├── src/
│   ├── content.config.ts     # 文档集合 Schema 定义
│   ├── content/docs/         # 导入后的 Markdown（构建时生成，已 gitignore）
│   ├── lib/content.ts        # 分类、标签、URL 等公共逻辑
│   ├── pages/
│   │   ├── index.astro       # 首页
│   │   ├── docs/             # 知识库列表与文档详情
│   │   ├── categories/       # 分类索引与分类详情
│   │   ├── tags/             # 标签索引与标签详情
│   │   ├── rss.xml.ts        # RSS 订阅
│   │   └── sitemap.xml.ts    # 站点地图
│   └── styles/global.css
└── public/                   # 静态资源（含导入的图片）
```

## 快速开始

### 环境要求

- Node.js 18+
- npm

### 安装依赖

```bash
npm install
```

### 准备 Markdown 源文件

将 Markdown 文档放在项目根目录的 `bypassAV-study-main/` 下（或通过环境变量指定其他路径）。目录一级文件夹名即为分类名，例如：

```text
bypassAV-study-main/
├── 01_C&C++快速入门/
│   └── 课时01_Windows环境配置.md
├── 06_Windows内核安全/
│   └── 课时02_第一个驱动程序.md
└── images/                   # 可选，文档引用的图片
```

也可通过环境变量自定义源目录：

```bash
# Windows PowerShell
$env:CONTENT_SOURCE_DIR = "C:\path\to\your\markdown"

# Linux / macOS
export CONTENT_SOURCE_DIR=/path/to/your/markdown
```

### 开发

```bash
npm run import   # 导入 Markdown 到 src/content/docs/
npm run dev      # 启动开发服务器（默认 http://localhost:4321）
```

### 构建与预览

```bash
npm run build    # 导入 → Astro 构建 → Pagefind 索引生成
npm run preview  # 预览构建产物
```

`build` 脚本等价于：

```bash
npm run import && astro build && pagefind --site dist
```

## 页面路由

| 路径 | 说明 |
| --- | --- |
| `/` | 首页（精选文章、最近更新、分类预览） |
| `/docs/` | 知识库文档列表 |
| `/docs/<slug>/` | 单篇文档详情（含文章目录导航） |
| `/categories/` | 全部分类 |
| `/categories/<slug>/` | 某分类下的文档 |
| `/tags/` | 全部标签 |
| `/tags/<slug>/` | 某标签下的文档 |
| `/rss.xml` | RSS 2.0 订阅源 |
| `/sitemap.xml` | XML 站点地图 |

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `CONTENT_SOURCE_DIR` | Markdown 源目录路径 | `./bypassAV-study-main` |
| `SITE_URL` | 站点根 URL（影响 RSS、Sitemap 链接） | `https://sun-ji-ao.github.io` |

## 部署

### GitHub Pages

1. 将 `CONTENT_SOURCE_DIR` 指向可用的 Markdown 源（或在 CI 中 checkout 内容仓库）
2. 执行 `npm run build`，将 `dist/` 目录部署到 Pages

### Cloudflare Pages

- **构建命令：** `npm run build`
- **输出目录：** `dist`
- 在环境变量中设置 `SITE_URL` 为实际域名

## 内容导入说明

`scripts/import_markdown.mjs` 在每次构建前执行，主要完成：

1. 扫描源目录下所有 `.md` 文件
2. 根据路径推断分类、标题、课时序号
3. 根据分类与标题关键词自动推断标签（Windows、Kernel、PE、Reverse 等）
4. 规范化代码块语言标识（如 `c++` → `cpp`）
5. 剥离已有 frontmatter，写入统一元数据
6. 复制 `images/` 到 `public/imported-images/`

导入结果写入 `src/content/docs/`，该目录已在 `.gitignore` 中忽略，不纳入版本控制。

## 许可证

本项目网站代码仅供个人学习使用。Markdown 文档内容的版权归原作者所有。
