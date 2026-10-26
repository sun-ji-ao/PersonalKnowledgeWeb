# 2026-09-28 运行保障续记

生产浏览器验收由用户明确暂缓；VPN、订阅、NewAPI 客户端验收由用户确认完成。本轮没有修改这些服务的配置，没有重启生产网站。

## 已执行

- 新增 `technical-notes-lab/deploy/production-backup.sh` 并部署至服务器 `~/technical-notes/production-backup.sh`。通过 systemd 获取当前程序目录，数据目录仍独立于 release；使用 flock 防止同时运行，只有成功才更新 `runtime/backup-last-success.txt`。
- 旧 cron 日志确认 9 月 25、26、27 日每天成功一次。精确替换网站 cron，时间仍是服务器时区每天 03:15（当前 PDT，对应北京时间 18:15；夏令时变化后会偏移）。其他 cron 不改，旧计划保存为 `runtime/crontab-before-production-1790525549149070759.txt`。
- 新快照：`backups/backup-2026-09-27T16-08-04-605Z-71c39643`，254 个清单文件。UTC 时间对应北京时间 9 月 28 日 00:08。
- 隔离恢复至 `~/technical-notes/restore-check-20260928-production`：数据库完整性 ok，253 篇文章、253 发布、506 归档引用、0 媒体；旧路径 302、私有接口 401、RSS origin 正确。恢复进程已退出，恢复目录保留。
- `sh -n` 通过；网站、Nginx、Hysteria 均 active。未重新运行应用全套测试，原应用基线仍为 84/84。

本次只验证当前快照恢复，不把它计作“升级后新增内容恢复”或“生产崩溃重启”验收。新脚本是独立运维文件，之前 b9 压缩包仍是原版本。

## 历史手动命令（无需重复执行）

2026-09-28 续记：用户此前的离机备份已通过校验，下面下载新快照的命令仅为可选备用操作，不是必做项。现已开发离机自动复制和检查工具，Windows 每天 20:00 执行；最新验收与状态见 [备份自动化](./B9-BACKUP-AUTOMATION.md)。

### 1. Windows 保存本次新快照

此前 14:14 的离机副本已校验通过。本次 16:08 快照尚未下载，可在 PowerShell 逐行执行，避免反引号续行：

```powershell
New-Item -ItemType Directory -Force 'C:\Users\17536\Desktop\technical-notes-backups'
scp -i C:\Users\17536\.ssh\ucloud_deploy -P 22 -r sunjiao@165.154.163.29:/home/sunjiao/technical-notes/backups/backup-2026-09-27T16-08-04-605Z-71c39643 C:\Users\17536\Desktop\technical-notes-backups\
if ($LASTEXITCODE -ne 0) { throw '下载失败' }
$backupPath = 'C:\Users\17536\Desktop\technical-notes-backups\backup-2026-09-27T16-08-04-605Z-71c39643'
$manifest = Get-Content -LiteralPath "$backupPath\manifest.json" -Raw | ConvertFrom-Json
foreach ($entry in $manifest.files) {
    $filePath = Join-Path $backupPath $entry.path
    if (!(Test-Path -LiteralPath $filePath)) { throw "缺失：$($entry.path)" }
    if ((Get-Item -LiteralPath $filePath).Length -ne $entry.size) { throw "大小不符：$($entry.path)" }
    if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne $entry.sha256) { throw "哈希不符：$($entry.path)" }
}
"校验通过：$($manifest.files.Count) 个文件"
```

这些命令只下载备份，不修改生产内容。电脑侧已建立自动复制任务，首次自然触发仍待观察；重要写作或发布后可按新指南主动触发一次同步。服务器和电脑暂保留所有快照，不自动删除，待测定增长量后制定保留规则。

### 2. 下次计划时间之后确认自动执行

SSH 登录服务器后执行，无需 sudo：

```sh
crontab -l
tail -n 5 ~/technical-notes/runtime/backup.log
cat ~/technical-notes/runtime/backup-last-success.txt
date -u
df -h ~/technical-notes
```

最后成功时间应更新，日志应出现新快照。仅手动运行成功不能证明 cron 已自动运行。超过 26 小时没有新成功记录或磁盘不足时，应先查看日志；当前尚没有外部告警渠道。

## 下一轮开发与执行

1. 离机复制工具、备份检查与保留预览已实现，Windows 定时任务已安装；等待首次自然触发，外部告警尚未接入。
2. 完成程序部署/回退工具：更新前备份、候选版本隔离检查、服务健康检查、失败回退；数据库结构兼容性必须核对，禁止直接覆盖生产库。切换 systemd 所需 sudo 命令届时提供。
3. 审查 Git 忽略项并整理源码与文档版本；当前未提交、未推送，运行数据和备份不得混入源码。
4. 建立首页、搜索、公开列表的性能基线后决定优化范围。
5. 待用户恢复生产浏览器验收；择维护窗口验证网站自身 systemd 故障恢复。证书模拟续期已通过，真实续期及加载仍需后续观察。

以上待办没有因为本次备份成功而关闭。无需重复配置 DNS、证书或共存服务。
