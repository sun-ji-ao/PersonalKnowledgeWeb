# 网站开发文档

本目录集中保存原站资料、新站开发方案和评审验收记录。

本地默认启动仍是 Markdown MVP；生产环境显式运行 HTML 模式，具备原件归档、上传、可视化写作、版本化发布、媒体、分类检索和阅读工具。第 7 批迁移并修订 253 篇旧文，第 8 批完成旧 URL/锚点与恢复演练。2026-09-27 b9 已通过 UCloud 的 Nginx HTTPS 在 `sunjiao.me` 公开运行；本地完整回归 84/84，证书模拟续期与离机备份 254/254 清单校验通过。作者侧真实内容/写作和 VPN 客户端功能验收仍待回报。当前状态见 [b9 部署状态](./technical-notes-lab/B9-DEPLOYMENT-STATUS.md)。

## 新站开发

- [服务器共存服务与操作边界（含公司电脑专用记录服务）](./technical-notes-lab/SERVER-COEXISTENCE.md)

- [当前开发实现汇总](./technical-notes-lab/DEVELOPMENT-IMPLEMENTATION-SUMMARY.md)
- [b9 正式部署状态与后续验收](./technical-notes-lab/B9-DEPLOYMENT-STATUS.md)
- [第 8 批部署与运行保障验收](./technical-notes-lab/BATCH-08-ACCEPTANCE.md)
- [UCloud 部署与恢复指南（含历史私有预览）](./technical-notes-lab/UBUNTU-DEPLOYMENT-GUIDE.md)
- [第 7 批隔离迁移验收](./technical-notes-lab/BATCH-07-ACCEPTANCE.md)
- [第 7 批补漏与独立复核](./technical-notes-lab/BATCH-07-REPAIRS.md)
- [旧文批迁移工具与依赖](./technical-notes-lab/HTML-BATCH-MIGRATION-GUIDE.md)
- [开发任务清单与批次状态](./technical-notes-lab/TASKS.md)
- [开发日志](./technical-notes-lab/DEV-LOG.md)
- [第 1 批验收报告](./technical-notes-lab/BATCH-01-ACCEPTANCE.md)
- [第 2 批开发与验收报告（已完成）](./technical-notes-lab/BATCH-02-ACCEPTANCE.md)
- [第 3 批存储、归档和恢复报告](./technical-notes-lab/BATCH-03-ACCEPTANCE.md)
- [HTML 数据迁移与备份工具](./technical-notes-lab/HTML-DATA-GUIDE.md)
- [第 4 批 HTML 编辑器报告](./technical-notes-lab/BATCH-04-ACCEPTANCE.md)
- [第 5 批 HTML 发布与公开阅读报告](./technical-notes-lab/BATCH-05-ACCEPTANCE.md)
- [第 6 批媒体、检索和阅读报告](./technical-notes-lab/BATCH-06-ACCEPTANCE.md)
- [第 7 批两篇内容修订与阅读验收续记](./technical-notes-lab/BATCH-07-CONTENT-READING-ACCEPTANCE.md)
- [第 5/6 批独立集成验收](./technical-notes-lab/BATCH-05-06-INTEGRATION.md)
- [第 5/6 批浏览器验收记录](./technical-notes-lab/BATCH-05-06-BROWSER.md)
- [第 5/6 批三代理协作记录](./technical-notes-lab/BATCH-05-06-COORDINATION.md)
- [HTML 媒体、搜索和阅读使用说明](./technical-notes-lab/HTML-MEDIA-SEARCH-GUIDE.md)
- [HTML 写作台启动与接口](./technical-notes-lab/HTML-EDITOR-GUIDE.md)
- [第 3/4 批独立集成验收](./technical-notes-lab/BATCH-03-04-INTEGRATION.md)
- [第 4 批浏览器验收](./technical-notes-lab/BATCH-04-BROWSER.md)
- [第 3/4 批三代理协作记录](./technical-notes-lab/BATCH-03-04-COORDINATION.md)
- [转换与离线预检查工具用法](./technical-notes-lab/CONVERSION-GUIDE.md)
- [当前开发计划](./technical-notes-lab/PLAN.md)
- [HTML 正文、Markdown 转换与迁移设计](./technical-notes-lab/HTML-CONTENT-DESIGN.md)
- [统一 HTML 正文规范 notes-html/1](./technical-notes-lab/HTML-SOURCE-SPEC.md)
- [转换黄金样例和基线证据](./technical-notes-lab/batch-01/README.md)
- [启动、使用和维护说明](./technical-notes-lab/README.md)
- [MVP 自动化测试报告](./technical-notes-lab/TEST-REPORT.md)

源代码位于仓库根目录的 `technical-notes-lab/`。文档移动不改变启动命令的工作目录、数据库或附件位置。

## 评审与验收

- [三代理交付索引](./review-output/README.md)
- [现有项目分析](./review-output/existing-project-analysis.md)
- [架构决策评审](./review-output/architecture-decision.md)
- [浏览器验收记录](./review-output/browser-acceptance.md)
- [Markdown 上传验收样例](./review-output/writing-smoke.md)

## 原站资料

- [原站说明](./existing-site/README.md)
- [知识网站项目方案计划书](<./existing-site/1.1 知识网站项目方案计划书.md>)
- [网站示意图](<./existing-site/1.2 网站示意图/1.2 网站示意图.svg>)
- [项目代码架构设计文档](<./existing-site/1.3 项目代码架构设计文档.md>)
- [项目当前功能与后续操作说明](<./existing-site/1.4 项目当前功能与后续操作说明.md>)
- [部署上线操作手册](<./existing-site/1.5 部署上线操作手册.md>)

原站资料中的代码路径和命令均以仓库根目录为基准，新站资料中的代码路径和命令默认以新站源码目录为基准。
