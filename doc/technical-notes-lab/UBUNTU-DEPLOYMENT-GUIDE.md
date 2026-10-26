# UCloud Ubuntu 部署与恢复

本指南保留 2026-09-25 私有预览部署过程，供恢复和比较。**当前正式运行状态**见 [b9 部署状态](./B9-DEPLOYMENT-STATUS.md)：2026-09-27 起 `sunjiao.me` 由 UCloud 现有 Nginx TCP 443 承载动态站，systemd 运行 b9；VPN UDP 443、订阅 TCP 8080 和 NewAPI TCP 3000 保持原用途。证书 HTTP-01 模拟续期和本机离机备份清单已通过，作者侧浏览器及客户端功能验收仍待确认。下述 b8 私有预览和切换计划为历史记录，不应再按顺序重复执行。

## 服务器布局

| 路径 | 用途 |
| --- | --- |
| `~/technical-notes/node-runtime` | 单独安装的 Node 24，不替换系统 Node 20 |
| `~/technical-notes/releases/b8` | 历史私有预览及当前 cron 使用的备份脚本 |
| `~/technical-notes/releases/b9` | 当前 systemd 正式运行的应用代码和锁定依赖 |
| `~/technical-notes/content` | 已发布 253 篇的 SQLite、私有原件、媒体；升级时不可覆盖 |
| `~/technical-notes/runtime` | 管理员口令文件、会话/限流数据库、日志和 PID；权限限制为当前用户 |
| `~/technical-notes/backups` | 联合备份；另需离机副本 |

SSH 使用用户自己保存的密钥；本仓库不记录服务器公网 IP、密钥路径或密钥内容。不要把私钥或 `runtime/admin-password.txt` 加入 Git/文档/上传包。应用包按 `server.mjs package.json package-lock.json example.md lib public scripts deploy` 白名单制作，内容包仅为 `notes.sqlite source-archives media`；`.test-data`、默认真实 `data`、用户口令和依赖缓存不进入包。安装时用用户目录 Node 24 执行锁定版 `npm ci --omit=dev`。

## 私有预览

服务器执行：

```sh
sh ~/technical-notes/releases/b8/deploy/private-preview.sh status
sh ~/technical-notes/releases/b8/deploy/private-preview.sh start
# 需要停止时：
sh ~/technical-notes/releases/b8/deploy/private-preview.sh stop
```

脚本固定 `127.0.0.1:4310`、`HTML_EDITOR=1`、`SEED_DEMO=0`，数据在代码目录外。浏览器要在自己的电脑访问时，先建立 SSH 隧道（保留该命令运行）：

```powershell
ssh -i <SSH_PRIVATE_KEY> -p 22 -N -L 127.0.0.1:4310:127.0.0.1:4310 sunjiao@<SERVER_IP>
```

随后打开 `http://127.0.0.1:4310/`。管理员初始口令只可由服务器本人读取 `~/technical-notes/runtime/admin-password.txt`，切勿放在聊天或仓库。隧道关闭后外部无法访问。端口 4310 若本机被占用，需要调整本机转发端口并同时处理应用 Host 校验；不要把服务器监听地址改为 `0.0.0.0`。

## 备份和恢复

在应用 release 目录内，以 Node 24 执行 `scripts/html-scheduled-backup.mjs`，明确设置 `DATA_DIR`、`HTML_DB_PATH`、`HTML_ARCHIVE_DIR`、`HTML_MEDIA_DIR`、`BACKUP_DIR` 为上述用户目录的绝对路径。当前 `sunjiao` 用户 crontab 每天服务器本地 03:15 运行 b8 的 `deploy/private-backup.sh`，日志在 `~/technical-notes/runtime/backup.log`；`@reboot` 私有预览项已移除，正式站由 systemd 启动。2026-09-27 切换前联合备份已复制到本机并按清单 254/254 校验，下一次定时真实触发、持续离机复制与告警仍待验收。计划将备份入口从 b8 迁到 b9，但在新入口通过恢复验收前保留当前有效 cron。

恢复演练命令：

```sh
cd ~/technical-notes/releases/b8
~/technical-notes/node-runtime/node_modules/node/bin/node scripts/html-recovery-drill.mjs \
  ~/technical-notes/backups/backup-2026-09-24T16-25-32-133Z-5af8c3ca \
  ~/technical-notes/recovery-drill-20260925
```

恢复目标必须是不存在的新目录。脚本验证 SQLite、原件与媒体清单，并启动短时隔离实例检查公开和私有接口。实机返回 253 篇、253 发布、506 归档引用、旧 URL 302、私有 API 401。`auth.sqlite` 不属于内容联合备份；在新的运行时恢复后需要重新登录。恢复不自动替换运行库。若未来发生事故，先停止写入并备份受损现场，再恢复到新目录、逐项核验，最后由操作员明确切换路径。

## 更新与公开发布边界

代码升级应建新的 `releases/<版本>`、重新 `npm ci` 和预检，再同时更新预览脚本、备份脚本及用户 crontab 指向新 release；保留 `content`、`runtime` 和原 release。升级前后分别备份，并以新增合成草稿的恢复试验证明不会丢新写入。部署不得从 Markdown 隐式重转或覆盖已在线编辑的 HTML。

现行正式部署计划：b9 程序包已上传并通过隔离测试；下一步确认服务文件指向实际存在的目录与 `PUBLIC_ORIGIN=https://sunjiao.me`，由具备 sudo 权限的操作员启动 systemd；取得覆盖 apex 和 www 的证书，给现有 Nginx 添加独立 TCP 443 虚拟主机代理 `127.0.0.1:4310`，在 DNS 切换前用 `curl --resolve` 与浏览器验收。最后到阿里云将 apex A 指向 UCloud，并核验自动续期与回退。旧站 `/docs/`、分类、标签、归档、搜索入口须随新版验收。原 VPN UDP 443 与网站 TCP 443 可共存；不要改动订阅 TCP 8080、NewAPI TCP 3000 或启用 Caddy 的 UDP 443/HTTP3。

服务器曾创建指向 b9 的 `technical-notes.service`，因目录当时不存在而报 `200/CHDIR`；该故障已解决。2026-09-27 b9 已由 systemd 正式运行，旧 b9 保存在 `b9-before-navigation`；证书、Nginx 和 DNS 切换已完成，HTTP-01 模拟续期通过。当前待办见 [b9 部署状态](./B9-DEPLOYMENT-STATUS.md)，不要重复本指南中的历史启用流程。
