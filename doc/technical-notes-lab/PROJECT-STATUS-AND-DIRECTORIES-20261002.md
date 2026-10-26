# 项目完成情况与目录清单（2026-10-02）

依据 TASKS.md、DEV-LOG.md、B9-DEPLOYMENT-STATUS.md、B9-BACKUP-AUTOMATION.md，并只读核对本机目录与备份。应用部署记录最近更新于 9 月 28 日，本轮未连接生产服务器或执行生产浏览器验收。

## 已完成

| 范围 | 完成内容 |
| --- | --- |
| 第 1 批 | 基线、任务日志、notes-html/1 正文契约和验收样例 |
| 第 2 批 | Markdown 转 HTML、HTML 清洗规范化、代码高亮/公式/Mermaid、预检查 CLI、10 篇旧文浏览器检查 |
| 第 3 批 | SQLite 不可变修订、草稿/发布分离、私有原件归档、幂等导入、冲突保护、联合备份和恢复 |
| 第 4 批 | Markdown 上传、可视化 HTML 编辑、自动/手动保存、历史恢复、并发保护及隔离浏览器验收 |
| 第 5 批 | 发布/撤回、公开 HTML 阅读、草稿权限隔离、私有/公开导出及隔离浏览器验收 |
| 第 6 批 | 图片/附件、缺图补传、分类/标签、中文搜索、目录/进度/代码复制/图表查看、RSS/sitemap |
| 第 7 批 | 253 篇旧文隔离迁移、两篇内容诊断修订、全库结构检查及 5 篇抽样阅读，原件未改 |
| 第 8 批已交付部分 | 253 篇在 UCloud 发布，旧 URL 和 4,410 条锚点映射、旧导航、Nginx HTTPS、DNS、systemd、证书模拟续期、隔离恢复 |
| 第 9 批已交付部分 | 客户端验收用户确认；生产备份入口、离机压缩复制/校验/重复跳过、过期和磁盘检查、保留预览、Windows 20:00 任务 |

应用最近完整回归记录为 84/84，备份工具另有 7/7 针对性测试；两者不是本轮重新执行的合并测试结果。

## 待完成或待确认

| 编号/范围 | 待办 |
| --- | --- |
| B9-01/B8-06 | 生产域名下真实文章、旧 URL/锚点、登录、Markdown 上传及在线写作浏览器验收；用户明确暂缓 |
| B9-03c | 定时执行与离线补跑的正式证据归档；已发现后续成功同步，仍需结合服务器 cron 和 Windows 任务确认触发原因 |
| 当前备份时效 | 最新本机成功副本为 9 月 30 日 18:15 北京时间创建，当日 23:25 同步成功；10 月 2 日检查距创建约 51 小时，超过 26 小时阈值。须核对远端最新快照及本机任务结果，不能直接判断远端已停备份 |
| B9-03d | 外部失败通知渠道、电脑长期离线时的替代备份目的地 |
| B9-04 | 部署/程序回退工具、更新前备份、候选版本验证、健康检查和失败回退；备份入口与当前快照隔离恢复已完成，升级新增内容演练仍待补 |
| B9-05 | Git 忽略与源码/文档版本整理、可追溯回退源码；当前新应用与 doc 大量未跟踪 |
| B9-06 | 生产性能基线；根据测量决定公开列表/API、分页/缓存和搜索优化 |
| 运维验收 | 网站 systemd 真实故障恢复、证书真实续期及 Nginx 加载 |
| 内容后续 | 253 篇逐篇全文审校、跨设备生产阅读和外链持续检查；现有结构审计和代表性抽样不等同逐篇全文验收 |
| 清理维护 | 备份保留只做预览，失败暂存目录、传输缓存和历史验收产物尚未清理；清理不应直接删除来源和恢复证据 |

本机发现 5 个有效完整快照，0 个清单损坏，每个均为 254 项；首次失败的 .incoming 暂存目录不是有效快照。

## 目录用途

以下路径以 C:/Users/17536/Desktop/website 为根。

| 路径 | 用途 |
| --- | --- |
| technical-notes-lab | 当前动态网站源码，Node 24 + SQLite |
| technical-notes-lab/lib | 转换、正文、修订、发布、媒体、搜索、迁移、备份等核心实现 |
| technical-notes-lab/public | 编辑器、阅读交互、CSS、构建后的编辑器资源 |
| technical-notes-lab/scripts | 导入、预检查、迁移、部署预检查、备份/恢复/状态工具 |
| technical-notes-lab/deploy | 服务配置模板、生产备份、Windows 离机同步与任务安装脚本；Caddy/private-preview 等含历史方案，不代表当前 Nginx 配置 |
| technical-notes-lab/test | 自动化测试 |
| technical-notes-lab/data | 默认本地 Markdown MVP 数据库和管理员口令文件，含私有数据 |
| technical-notes-lab/.test-data | 隔离迁移库、修订库、预发布、备份与恢复、压缩传输验收；不是生产库 |
| technical-notes-lab/tmp | 浏览器和 HTTP 验收临时运行数据 |
| technical-notes-lab/node_modules、.npm-cache | 新站依赖和 npm 缓存 |
| doc/technical-notes-lab | 新站方案、规范、TASKS、DEV-LOG、使用指南、批次报告和验收证据 |
| doc/existing-site | 原 Astro 站方案和历史说明 |
| doc/review-output | 早期项目分析、架构评审和验收文档 |
| review-output/browser-data | 早期浏览器验收运行数据；与 doc/review-output 文档分开 |
| bypassAV-study-main | 原始 253 篇 Markdown 的 20 个内容专题，内容来源 |
| src | 原 Astro 静态站源码 |
| src/components、lib、pages、styles | 原站组件、公共逻辑、页面和样式 |
| src/content/docs | 原站导入生成的 Markdown 内容集合 |
| public、scripts | 原站静态资源和 Markdown 导入脚本 |
| .github/workflows | 原站 GitHub Pages 构建发布流程；未完成动态网站自动部署流程 |
| dist、.astro、node_modules | 原站构建产物、Astro 缓存和依赖 |
| .git | 整个仓库的版本历史和 Git 元数据 |

## 本机完整目录索引

列出所有项目目录；node_modules、.npm-cache、.git、.astro、dist 的内部实现目录不逐个展开，这些已作为整体列出。包含原文、文档及隔离数据目录的实际子目录，清单不读取私有文件内容。

- `.astro/`（依赖/缓存/生成目录，内部省略）
- `.git/`（依赖/缓存/生成目录，内部省略）
- `.github/`
- `.github/workflows/`
- `bypassAV-study-main/`
- `bypassAV-study-main/01_C&C++快速入门/`
- `bypassAV-study-main/02_x86_64架构汇编语言/`
- `bypassAV-study-main/03_C&C++软件逆向技术/`
- `bypassAV-study-main/04_Win32编程/`
- `bypassAV-study-main/05_进程通信专题/`
- `bypassAV-study-main/06_Windows内核安全/`
- `bypassAV-study-main/07_Windows网络编程/`
- `bypassAV-study-main/08_Windows_PE结构/`
- `bypassAV-study-main/09_加密壳/`
- `bypassAV-study-main/10_shellcode开发技术/`
- `bypassAV-study-main/11_shellcode_loader/`
- `bypassAV-study-main/12_远程控制开发基础/`
- `bypassAV-study-main/13_安全开发专题/`
- `bypassAV-study-main/14_Inject专题/`
- `bypassAV-study-main/15_HOOK专题/`
- `bypassAV-study-main/16_Anti_Debug专题/`
- `bypassAV-study-main/17_Anti_VM专题/`
- `bypassAV-study-main/18_CobaltStrike专题/`
- `bypassAV-study-main/19_提权专题/`
- `bypassAV-study-main/20_免杀专题/`
- `dist/`（依赖/缓存/生成目录，内部省略）
- `doc/`
- `doc/existing-site/`
- `doc/existing-site/1.2 网站示意图/`
- `doc/review-output/`
- `doc/technical-notes-lab/`
- `doc/technical-notes-lab/batch-01/`
- `doc/technical-notes-lab/batch-02/`
- `doc/technical-notes-lab/batch-02/contract-preview/`
- `doc/technical-notes-lab/batch-02/contract-preview/media/`
- `doc/technical-notes-lab/batch-02/legacy-final/`
- `doc/technical-notes-lab/batch-02/legacy-final/media/`
- `doc/technical-notes-lab/batch-02/legacy-preview/`
- `doc/technical-notes-lab/batch-02/legacy-preview/media/`
- `doc/technical-notes-lab/batch-02/ui-input/`
- `doc/technical-notes-lab/batch-04/`
- `doc/technical-notes-lab/batch-04/browser-fixtures/`
- `doc/technical-notes-lab/batch-06/`
- `doc/technical-notes-lab/batch-06/browser-fixtures/`
- `doc/technical-notes-lab/batch-07/`
- `node_modules/`（依赖/缓存/生成目录，内部省略）
- `public/`
- `review-output/`
- `review-output/browser-data/`
- `scripts/`
- `src/`
- `src/components/`
- `src/content/`
- `src/content/docs/`
- `src/content/docs/01_C&C++快速入门/`
- `src/content/docs/02_x86_64架构汇编语言/`
- `src/content/docs/03_C&C++软件逆向技术/`
- `src/content/docs/04_Win32编程/`
- `src/content/docs/05_进程通信专题/`
- `src/content/docs/06_Windows内核安全/`
- `src/content/docs/07_Windows网络编程/`
- `src/content/docs/08_Windows_PE结构/`
- `src/content/docs/09_加密壳/`
- `src/content/docs/10_shellcode开发技术/`
- `src/content/docs/11_shellcode_loader/`
- `src/content/docs/12_远程控制开发基础/`
- `src/content/docs/13_安全开发专题/`
- `src/content/docs/14_Inject专题/`
- `src/content/docs/15_HOOK专题/`
- `src/content/docs/16_Anti_Debug专题/`
- `src/content/docs/17_Anti_VM专题/`
- `src/content/docs/18_CobaltStrike专题/`
- `src/content/docs/19_提权专题/`
- `src/content/docs/20_免杀专题/`
- `src/lib/`
- `src/pages/`
- `src/pages/about/`
- `src/pages/archive/`
- `src/pages/categories/`
- `src/pages/docs/`
- `src/pages/page/`
- `src/pages/search/`
- `src/pages/tags/`
- `src/styles/`
- `technical-notes-lab/`
- `technical-notes-lab/.npm-cache/`（依赖/缓存/生成目录，内部省略）
- `technical-notes-lab/.test-data/`
- `technical-notes-lab/.test-data/batch-07-content-reviewed/`
- `technical-notes-lab/.test-data/batch-07-content-reviewed/media/`
- `technical-notes-lab/.test-data/batch-07-content-reviewed/source-archives/`
- `technical-notes-lab/.test-data/batch-07-library/`
- `technical-notes-lab/.test-data/batch-07-library/media/`
- `technical-notes-lab/.test-data/batch-07-library/source-archives/`
- `technical-notes-lab/.test-data/batch-07-library-final/`
- `technical-notes-lab/.test-data/batch-07-library-final/media/`
- `technical-notes-lab/.test-data/batch-07-library-final/source-archives/`
- `technical-notes-lab/.test-data/batch-07-library-final-backup/`
- `technical-notes-lab/.test-data/batch-07-library-final-backup/source-archives/`
- `technical-notes-lab/.test-data/batch-07-library-final-restored/`
- `technical-notes-lab/.test-data/batch-07-library-final-restored/media/`
- `technical-notes-lab/.test-data/batch-07-library-final-restored/source-archives/`
- `technical-notes-lab/.test-data/batch-07-mvp/`
- `technical-notes-lab/.test-data/batch-07-mvp/source-archives/`
- `technical-notes-lab/.test-data/batch-07-mvp-backup/`
- `technical-notes-lab/.test-data/batch-07-mvp-backup/source-archives/`
- `technical-notes-lab/.test-data/batch-07-mvp-restored/`
- `technical-notes-lab/.test-data/batch-07-mvp-restored/media/`
- `technical-notes-lab/.test-data/batch-07-mvp-restored/source-archives/`
- `technical-notes-lab/.test-data/batch-07-reading-preview/`
- `technical-notes-lab/.test-data/batch-07-reading-preview/media/`
- `technical-notes-lab/.test-data/batch-07-reading-preview/source-archives/`
- `technical-notes-lab/.test-data/batch-07-reading-preview-backup/`
- `technical-notes-lab/.test-data/batch-07-reading-preview-backup/source-archives/`
- `technical-notes-lab/.test-data/batch-08-before-publish/`
- `technical-notes-lab/.test-data/batch-08-before-publish/source-archives/`
- `technical-notes-lab/.test-data/batch-08-deploy/`
- `technical-notes-lab/.test-data/batch-08-published-backup/`
- `technical-notes-lab/.test-data/batch-08-published-backup/source-archives/`
- `technical-notes-lab/.test-data/batch-08-restored/`
- `technical-notes-lab/.test-data/batch-08-restored/media/`
- `technical-notes-lab/.test-data/batch-08-restored/source-archives/`
- `technical-notes-lab/.test-data/batch-08-stage/`
- `technical-notes-lab/.test-data/batch-08-stage/media/`
- `technical-notes-lab/.test-data/batch-08-stage/source-archives/`
- `technical-notes-lab/.test-data/batch-08-upgrade-backup/`
- `technical-notes-lab/.test-data/batch-08-upgrade-backup/source-archives/`
- `technical-notes-lab/.test-data/batch-08-upgrade-restored/`
- `technical-notes-lab/.test-data/batch-08-upgrade-restored/media/`
- `technical-notes-lab/.test-data/batch-08-upgrade-restored/source-archives/`
- `technical-notes-lab/.test-data/batch04-browser/`
- `technical-notes-lab/.test-data/batch04-browser/html-archives/`
- `technical-notes-lab/.test-data/offsite-transfer-acceptance/`
- `technical-notes-lab/.test-data/offsite-transfer-acceptance/backup-2026-09-27T16-08-04-605Z-71c39643/`
- `technical-notes-lab/.test-data/offsite-transfer-acceptance/backup-2026-09-27T16-08-04-605Z-71c39643/source-archives/`
- `technical-notes-lab/data/`
- `technical-notes-lab/deploy/`
- `technical-notes-lab/lib/`
- `technical-notes-lab/node_modules/`（依赖/缓存/生成目录，内部省略）
- `technical-notes-lab/public/`
- `technical-notes-lab/scripts/`
- `technical-notes-lab/test/`
- `technical-notes-lab/tmp/`
- `technical-notes-lab/tmp/batch-05-06-ui-20260924/`
- `technical-notes-lab/tmp/batch-05-06-ui-20260924/html-archives/`
- `technical-notes-lab/tmp/batch-05-06-ui-20260924/media/`
- `technical-notes-lab/tmp/batch-06-browser/`
- `technical-notes-lab/tmp/batch-06-browser/html-archives/`
- `technical-notes-lab/tmp/batch-06-browser/media/`
- `technical-notes-lab/tmp/batch-07-http-runtime/`
- `technical-notes-lab/tmp/batch-07-reading-ui-20260924/`

## 仓库外的相关位置

| 位置 | 关联 |
| --- | --- |
| C:/Users/17536/Desktop/technical-notes-backups | 本机离机内容备份、同步成功记录和日志；本轮确认目录存在 |
| C:/Users/17536/.ssh | 网站 SSH 连接密钥所在目录；不是应用源码或内容备份 |
| C:/Users/17536/Desktop/ai-gateway | 同服务器 NewAPI 项目，与网站是共存服务；本轮确认目录存在，不属于网站源码 |
| C:/Users/17536/Desktop/VPN部署.md | VPN 部署资料，是文件，不是文件夹；本轮确认存在 |

## 服务器目录（依据部署文档，本轮未远端核查）

| 路径 | 用途 |
| --- | --- |
| /home/sunjiao/technical-notes/releases/b9 | 文档记录的当前网站程序 |
| /home/sunjiao/technical-notes/releases/b8、b9-before-navigation | 历史程序/保留副本，回退前必须核对数据库兼容性 |
| /home/sunjiao/technical-notes/content | 生产内容根目录 |
| /home/sunjiao/technical-notes/content/source-archives | 私有 Markdown 原件 |
| /home/sunjiao/technical-notes/content/media | 生产图片和附件 |
| /home/sunjiao/technical-notes/runtime | 运行状态、日志、锁及备份成功标记 |
| /home/sunjiao/technical-notes/backups | 服务器联合备份及传输缓存 |
| /home/sunjiao/technical-notes/node-runtime | 用户目录中独立 Node 24 运行时 |
| /home/sunjiao/technical-notes/restore-check-20260928-production | 最近文档中的隔离恢复验收目录 |
| /etc/technical-notes | 正式环境变量配置 |
| /etc/nginx/sites-available、sites-enabled | 网站代理配置所在的共享目录，也涉及共存服务 |
| /etc/letsencrypt/live/sunjiao.me、renewal | 网站 TLS 证书及续期配置 |

systemd 网站服务配置是 /etc/systemd/system/technical-notes.service 文件。

## 重要根文件

technical-notes-lab/server.mjs 是新站入口；根 package.json、astro.config.mjs、tsconfig.json 属于原 Astro 项目；content_dates.json 和 content_rules.json 为原站导入元数据/规则；technical-notes-b9.tar.gz 为历史程序发布包，不是完整内容备份，也不含后续新增的全部运维脚本。

文档中的历史报告有“未切换”“客户端待验”等旧状态；当前状态优先采用 TASKS 第 8/9 批、DEV-LOG 最新条目、B9 部署与备份记录，以及本页明确列出的本机新证据。

## 新增服务器共存目录：codex-recorder

用户补充：/home/sunjiao/codex-recorder 为公司办公电脑专用请求记录服务；runtime/data/records 保存加密记录，runtime/data 保存策略与指纹，runtime/secrets 保存密钥与管理密码。公司电脑 127.0.0.1:19180 经 Xshell 转发至服务器 127.0.0.1:18180。本机不使用此服务，网站备份不包含这些数据。详细边界见 [服务器共存服务](./SERVER-COEXISTENCE.md)。此目录不属于网站源码，本轮未远端核验。
