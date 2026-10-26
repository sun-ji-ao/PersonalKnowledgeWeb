# 第 9 批：备份自动化与状态检查

更新于 2026-09-28。本轮只处理计划第 1、2 项。生产浏览器验收继续暂缓；客户端验收已完成。之前下载且校验通过的备份继续有效，无须人工重复下载。

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
