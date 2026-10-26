# 第 9 批：备份自动化与状态检查

更新于 2026-10-27。自动同步故障已修复，Windows 调度器自动触发验收通过，已启用本聊天的每小时备份异常监控。生产浏览器验收继续暂缓；客户端验收已完成。

## 当前执行与告警（2026-10-27）

本机此前最后成功同步为 10 月 10 日。10 月 12 日运行中断留下 `.sync.lock`，后续任务因 `EEXIST` 持续失败；锁中 PID 对应进程已不存在。现改用操作系统管理的互斥锁（Windows 命名管道、Linux 抽象套接字），进程退出或被强制终止后自动释放。旧锁仅在确认进程不存在时改名留存；仍有进程或格式异常时拒绝继续并记录失败。并发启动不会覆盖正在运行的状态。

`sync-last-run.json` 原子记录本次运行、成功或失败，`sync-last-success.json` 保留最后一次完整成功。新增 `status` 命令同时检查本机备份与同步记录；旧成功记录不能掩盖新失败。SSH 设置连接与存活超时，PowerShell 正确捕获原生命令退出码。

Windows 任务 `TechnicalNotes-OffsiteBackup` 当前设置：

- 本机北京时间每天 **20:00**，当前用户登录时补跑；错过计划后尽快执行。
- 失败每隔 **15 分钟重试，最多 3 次**；单次最多 20 分钟，禁止并行运行，隐藏窗口。
- 使用当前用户交互登录令牌和普通权限，需要电脑开机、用户登录、网络与 SSH 密钥可用。
- 更新使用 `install-offsite-task.ps1 -UpdateExisting`，保存旧任务 XML 到备份目录的 `task-history/`，保留现有主体和日程。配置路径转换为绝对路径。

已在 Codex 当前聊天创建并启用“网站备份异常监控”，每小时只读运行 `status`。首次异常、异常类型变化、恢复正常或需要用户处理时通知；状态不变时保持安静。检测范围包括超过 26 小时没有有效新快照、最近同步失败、运行超过 20 分钟未完成、清单损坏、可用空间不足 1 GiB，以及检查无法完成。监控不会删除备份、改任务或部署应用。

**告警依赖电脑和 Codex 在线。**目前未配置邮件或 Webhook，不能保证电脑关闭期间实时通知；恢复执行后检查当前状态。自动化创建成功，异常判定已通过测试，但尚未通过真实故障演练验证聊天通知送达。离线后补跑设置已安装，未通过实际关机再开机演练。

### 实际验收

以下均为北京时间：

| 检查 | 结果 |
| --- | --- |
| 服务器 cron | 只读确认新入口在 10 月 19～26 日连续产出备份；最新快照创建于 10 月 26 日 18:15:01 |
| 真实离机下载 | 10 月 27 日 00:15:01～00:15:27 成功，`downloaded=true`，254 文件、27,323,219 字节校验通过 |
| Windows 自行触发 | 临时一次性触发器于 00:18:12 自行启动，00:18:19 同步成功，`LastTaskResult=0`，`downloaded=false`；未调用手动启动命令 |
| 触发器收尾 | 临时触发器已移除，仅保留每日和登录触发器；下一次日常计划为 10 月 27 日 20:00 |
| 最终本机健康检查 | `healthy=true`、9 个有效快照、0 个无效快照；最新快照 254 文件逐项校验通过 |
| 回归与复核 | Windows 下 `node --test test/backup-maintenance.test.mjs` 12/12 通过，独立代码复核无剩余问题 |

首次手动验收曾返回 `0xC000013A`，未获得足够证据确认中断原因；随后隐藏窗口版本的真实下载和调度器自行触发均成功。测试覆盖并发互斥、强制终止后再运行、旧锁恢复/拒绝、失败不覆盖旧成功、重试成功、过期/损坏/中断状态，以及带空格相对配置路径。Linux 分支未在实机运行。本次未改应用运行逻辑，未重跑完整应用测试，也未重新部署网站。

最新快照为 `backup-2026-10-26T10-15-01-466Z-7213cd0c`。服务器备份仍使用现有 cron；本次没有修改服务器时间表。历史“北京时间 18:15”对应当时服务器时区，夏令时变化可能改变北京时间映射。

### 当前检查命令

```powershell
node C:\Users\17536\Desktop\website\technical-notes-lab\scripts\backup-maintenance.mjs status C:\Users\17536\Desktop\technical-notes-backups
Get-ScheduledTaskInfo -TaskName TechnicalNotes-OffsiteBackup
Get-Content 'C:\Users\17536\Desktop\technical-notes-backups\sync-last-run.json' -Raw
Get-Content 'C:\Users\17536\Desktop\technical-notes-backups\offsite-sync.log' -Tail 15
```

`status` 返回 0 表示健康、2 表示需关注；执行错误返回 1。快照保留仍仅提供“最近 30 天且至少 7 份”的删除建议，不自动删除。已验证旧副本、恢复的旧锁及失败暂存目录均保留。

## 历史记录（2026-09-28，以下描述当时状态）

下文中的“首次触发待观察”“人工处理残留锁”“尚未接入通知”已由上述当前状态取代，保留用于追溯初次安装和传输排障。

## 定时执行核查

服务器核查时为 2026-09-27 16:47 UTC，即北京时间 9 月 28 日 00:47。新入口是在此前约 00:12 切换，下一次服务器 cron 为北京时间 9 月 28 日 18:15，因此尚无新入口自然触发证据。旧入口 9 月 25～27 日连续成功，新入口手动备份和恢复已通过。不能提前勾选“首次定时触发”。磁盘 77 GB，已用 5.8 GB，可用 71 GB。

## 工具与行为

- `scripts/backup-maintenance.mjs`：`verify` 校验单个快照；`inventory` 输出状态及保留预览；`check` 在异常时返回非零退出码；`sync` 下载最新已验证快照。
- 校验清单格式、路径边界、文件大小和 SHA-256，拒绝重复条目和符号链接。最新有效快照超过 26 小时、时间明显超前、存在损坏快照或剩余空间小于 1 GiB 时标记异常。
- 服务器将清单内文件打包后传输，减少逐文件网络往返，不包含清单外文件；下载先进入 `.incoming-*`；通过校验后才移到正式快照目录。已有同名目录重新校验后跳过下载；失败保留暂存内容供排查，不覆盖旧快照。`.sync.lock` 防止并发；异常断电后若锁残留，应确认没有复制进程再人工处理。
- 保留策略仅预览：保留最近 30 天全部快照，并至少保留最新 7 份；其他项标为 `review-for-deletion`。没有自动删除功能。仅统计清单命名的完整快照，不处理其他压缩包、恢复目录或 `.incoming-*`。
- `deploy/offsite-backup.json` 配置 SSH 主机、密钥路径和本机目录，不包含密钥内容或密码。
- `deploy/sync-offsite-backup.ps1` 记录执行日志，向 Windows 任务计划返回退出码。0 为成功、2 为状态异常、1 为执行错误。

清单校验用于发现缺失和损坏，不替代隔离恢复演练。该备份涵盖应用内容库、原件和媒体；系统配置、TLS 私钥、会话运行库不在此内容清单内。

## Windows 定时任务

已注册 `TechnicalNotes-OffsiteBackup`，本机中国标准时间每天 20:00。使用当前用户交互登录令牌、普通权限运行，不保存登录密码；需要用户已登录、电脑开机联网、SSH 密钥可用。启用错过计划后尽快执行及禁止并行运行，最长执行 20 分钟。它不是全天在线的外部备份服务，电脑长期离线时仍需其他备份目的地。

本轮注册成功，首次自然触发尚待观察。安装脚本遇到同名任务会停止，不覆盖现有设置。不要移动当前 workspace 内的脚本目录，否则需更新任务路径。

在 PowerShell 查看：

```powershell
Get-ScheduledTask -TaskName TechnicalNotes-OffsiteBackup
Get-ScheduledTaskInfo -TaskName TechnicalNotes-OffsiteBackup
Get-Content 'C:\Users\17536\Desktop\technical-notes-backups\offsite-sync.log' -Tail 15
Get-Content 'C:\Users\17536\Desktop\technical-notes-backups\sync-last-success.json' -Raw
```

首次运行前日志可能不存在。`LastTaskResult=0` 且成功记录时间更新才算本次成功，旧的成功记录不能掩盖最近失败。

需要主动补一次离机同步时：

```powershell
Start-ScheduledTask -TaskName TechnicalNotes-OffsiteBackup
```

这会异步启动任务；完成后查看上述状态。已有最新有效副本会跳过下载。

仅检查本机副本与保留预览：

```powershell
node C:\Users\17536\Desktop\website\technical-notes-lab\scripts\backup-maintenance.mjs check C:\Users\17536\Desktop\technical-notes-backups
```

服务器 SSH 登录后检查内容备份：

```sh
~/technical-notes/node-runtime/node_modules/node/bin/node ~/technical-notes/backup-maintenance.mjs check ~/technical-notes/backups
tail -n 5 ~/technical-notes/runtime/backup.log
cat ~/technical-notes/runtime/backup-last-success.txt
```

这些状态检查不需要 sudo，不改网站和共存服务。尚未接入外部通知；当前失败可通过任务结果、日志和状态检查发现。

## 验收

新增工具测试 7/7 通过：同大小内容篡改、文件缺失、路径越界、重复条目、过期/未来时间、损坏清单、保留策略边界与不删除。另外验证了子进程失败/超时能够退出、压缩包仅包含清单文件。真实压缩传输在已忽略的隔离目录通过：254 文件、27,323,219 字节，healthy=true。桌面备份目录也已有本次新快照并通过全部 254 项校验，旧副本保留。实际启动 Windows 任务后 LastTaskResult=0，成功记录 downloaded=false，证明已有同名有效快照不重复下载。没有更改应用运行逻辑，未重跑原应用全部测试。

## 留待观察

1. 新服务器入口首次 cron 自然触发。
2. Windows 任务首次自然触发、电脑离线后补跑。
3. 外部告警渠道及长期离线替代方案。

文档中的执行命令用于按需检查，无须重复配置 DNS、证书、VPN 或 NewAPI。

传输排障：首次 SFTP 逐文件传输超时，保留了未完成暂存目录；旧 SCP 逐文件重试最终成功。最终版本改为 SSH 生成仅含清单文件的压缩包再传输，真实验收通过；超时会终止传输子进程并释放同步锁。首次失败留下的 `.incoming-*` 暂存目录不算有效备份，未自动删除；成功传输的暂存目录已收尾。旧 sync.log 为排障历史，正式日志统一为 UTF-8 的 offsite-sync.log。服务器 `.transfer-*.tar.gz` 是传输缓存，不纳入快照保留统计；当前未自动清理。

最终核查：服务器 10 个有效快照、0 个无效快照，healthy=true，剩余空间 75,858,219,008 字节；Windows 任务于北京时间 01:03 再次运行，LastTaskResult=0，UTF-8 日志正常，downloaded=false。下一次 Windows 计划时间为 2026-09-28 20:00。相关文档本地链接核查无断链。本轮无需用户再下载备份或重新安装任务。
