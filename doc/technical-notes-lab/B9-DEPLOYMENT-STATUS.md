# b9 正式部署状态与后续验收

2026-10-27 更新：备份自动执行和聊天告警已完成，详见 [备份自动化](./B9-BACKUP-AUTOMATION.md)。[部署与回退工具](./B9-RELEASE-AUTOMATION.md)已安装服务器，Ubuntu 14/14 测试及新增草稿隔离恢复通过；正式服务仍为 b9，候选 b10-release-tools-20261027 尚待用户 sudo 认证后激活。应用与文档已纳入 GitHub 版本管理；下文保留早期部署记录。

2026-10-02 共存服务补充：用户新增 codex-recorder，仅公司办公电脑经 Xshell 隧道使用。本轮仅登记文档，未远端核验。网站操作须保留其容器、网络、转发配置和私有记录/密钥；见 [服务器共存服务](./SERVER-COEXISTENCE.md)。

2026-09-28 备份续记：离机复制、校验、状态检查和保留预览工具已实现，Windows 每日 20:00 任务已注册；新计划首次自然触发待观察。详见 [备份自动化](./B9-BACKUP-AUTOMATION.md)。

更新于 2026-09-28。生产浏览器验收暂缓；客户端验收用户已确认完成。新生产备份入口及隔离恢复通过，最新操作见 [运维续记](./B9-OPERATIONS-20260928.md)。

`sunjiao.me` 已由阿里云 DNS 指向 UCloud，现有 Nginx TCP 443 代理本机 Node 4310。`technical-notes.service` active/enabled，b8 私有预览已停。VPN 仍使用 UDP 443，订阅 Nginx 使用 TCP 8080，NewAPI 使用 TCP 3000。原 GitHub Pages 站保留作 DNS 回退来源，不再承担当前公开服务。

## 已验证

| 项目 | 证据与边界 |
| --- | --- |
| 代码与发布包 | 本地 `npm run build:editor` 通过、`npm test` 84/84；b9 包 361,063 字节，SHA-256 `8bff0ae411483f4987756e5bd546e3b3545346136bb9fe7ffd073b8dad370988`，服务器核对一致；Node 24 生产依赖安装 275 个、审计 0 漏洞。旧 b9 留在 `releases/b9-before-navigation`。 |
| 路由 | b9 隔离实例验证 `/_health`、`/docs/`、分类、标签、归档与搜索。正式公网不带 `--resolve` 的健康接口和首页 200，分类/标签/归档 200，`/docs/`、搜索入口 302；HTTP 80 与 www HTTPS 301 至主域名 HTTPS。253 条文章旧 URL 与 4,410 条锚点此前在私有预发布逐条验收，正式公网尚待作者抽样浏览器确认。 |
| DNS 与 TLS | 根域名 A 仅返回 UCloud 地址，`www` CNAME 指向根域名；证书覆盖两域名、有效至 2026-12-26。`certbot reconfigure --cert-name sunjiao.me --nginx --preferred-challenges http` 成功，续期配置 `authenticator = nginx`、`pref_challs = http-01,`；`renew --dry-run` 和 `nginx -t` 成功，certbot.timer 已安排。真实到期续期尚未发生。 |
| 数据 | 生产内容目录与 release 分离，保留 253 篇已发布旧文。切换前联合备份为 `backups/backup-2026-09-27T14-14-34-478Z-12df7966`；本机非仓库目录已有副本，解析清单并校验其中 254/254 个文件的大小及 SHA-256，0 失败。之前的服务器隔离恢复演练也通过。 |
| 共存服务 | `hysteria-server`、Nginx、网站服务均 active；UDP 443、TCP 3000/8080/443/80 监听；NewAPI 本机 `/api/status` 为 200。用户已确认客户端验收完成。 |
| 内容输出 | RSS `/rss.xml` 与站点地图 `/sitemap.xml` 在公网均 200。真实文章视觉、登录写作和 Markdown 上传尚未获作者在正式域名下确认。 |

## 尚需执行

1. 作者在普通浏览器检查首页、代表性长文、图片/代码/公式/图表、旧文章 URL/锚点、分类/标签/搜索，并登录 `/admin/html` 核对写作台。若做生产写入测试，使用明确标记的私有测试草稿，避免误改真实文章。浏览器操作结果记入本文件和 [TASKS](./TASKS.md)。
2. 客户端验收已完成，无须重复执行。
3. 观察下一次 cron 真实备份，明确离机复制频率、保留期限与失败告警。原 cron 连续三天成功，现已切换至 `~/technical-notes/production-backup.sh`；读取当前 systemd 程序目录，新入口手动备份及恢复通过，待首次定时触发。择机演练服务故障恢复和证书真实更新后的 Nginx 加载。
4. 审查 Git 忽略规则并将当前应用与文档纳入版本管理。应用、文档目前大量未跟踪；数据库、归档、媒体、备份、口令与 SSH 私钥不得提交。
5. 根据真实流量测量首页、搜索和公开 API，再决定分页/缓存等优化。一次公网 `/api/public/notes` 检查在 12 秒内收到约 4.6 MB 后超时，尚不足以判定根因，应另立性能基线。

## 回退与排障

DNS 旧值已导出：根域名原有四条 GitHub Pages A、www 原 CNAME。回退公开站时仅改网站 DNS，保留 UCloud 的新增数据和联合备份；不要用旧库覆盖生产库。应用故障先查看 `sudo journalctl -u technical-notes -n 80 --no-pager`，代理故障查看 `sudo nginx -t` 和 Nginx 错误日志。若要回退程序，必须先备份当前生产内容并核对旧 release 对当前数据库结构的兼容性，不可直接切换 `WorkingDirectory`。

部署过程中的 `200/CHDIR`、私有预览 Host 403、启动后立即 curl 的短暂连接失败，以及手动 DNS 证书改 HTTP-01 时首次遗漏 `--preferred-challenges http` 的经过见 [DEV-LOG](./DEV-LOG.md)；这些问题均已解决，不是当前待办。
