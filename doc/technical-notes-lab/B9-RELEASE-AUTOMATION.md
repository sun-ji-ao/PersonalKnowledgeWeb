# 网站部署与回退工具（2026-10-27）

部署工具已安装到 `/home/sunjiao/technical-notes/website-release.py`。**正式服务已于北京时间 2026-10-27 00:41:22 切换到 `releases/b10-release-tools-20261027`。**用户在自己的终端完成 sudo 认证并执行激活，随后通过独立 SSH 只读检查确认实际进程目录、systemd 状态和公开健康接口正常。服务器 Ubuntu 14/14 针对性测试及真实内容副本的启动、备份和旧版恢复演练通过。

## 激活命令记录（本次已执行，无需重复）

本次在已有服务器终端中执行的命令：

```sh
sudo -v && python3 ~/technical-notes/website-release.py activate b10-release-tools-20261027
```

在自己的终端输入服务器用户的 sudo 密码，不要发送给聊天。工具以普通网站用户运行，只在写入网站 drop-in、重新加载 systemd 配置和重启网站服务时调用 sudo。不要给整段 Python 脚本加 sudo；脚本拒绝 root 身份。没有修改 sudoers，也没有保存密码。首次切换会短暂重启网站。

也可以从本机 PowerShell 一次连接并执行：

```powershell
ssh -t -i C:\Users\17536\.ssh\ucloud_deploy sunjiao@165.154.163.29 "sudo -v && python3 ~/technical-notes/website-release.py activate b10-release-tools-20261027"
```

正常完成返回 JSON，`status` 为 `active`。后续只读检查：

```sh
python3 ~/technical-notes/website-release.py status
systemctl show technical-notes.service -p WorkingDirectory -p ActiveState -p MainPID
curl --fail --silent https://sunjiao.me/_health
```

## 执行流程与边界

1. 核对网站环境路径、当前 release、可用空间与所需文件；使用网站专属文件锁串行执行。
2. 比较入口、持久化关键文件及依赖文件的 SHA-256。不同则拒绝自动切换，提示独立迁移评审；不自动运行数据库迁移或更新依赖。依赖完全相同且候选尚无 node_modules 时，复制现有已安装依赖。
3. 从当前内容库建立新的联合备份，使用标准快照名称，使离机同步工具能够识别。备份失败就停止。
4. 在 `runtime/deployments/<id>/` 的副本上运行候选版本，检查完整性、文章数、旧 URL、私有接口和 RSS；比较启动前后的逻辑数据库摘要，拒绝隐式改变既有内容或结构的版本。
5. 仅在副本中新建合成私有草稿，再备份，并由旧代码恢复和检查。正常部署验证双向兼容；紧急回退只要求目标版本正常，不要求故障版本重新启动。
6. 保存此前网站 drop-in 和成功记录，写入待完成记录。使用原子替换更新 `/etc/systemd/system/technical-notes.service.d/90-website-release.conf` 的 WorkingDirectory；原 unit、环境文件、内容目录保持不变。
7. 只重启 `technical-notes.service`，同时检查本机健康接口和 MainPID 的实际工作目录。失败则还原此前 drop-in 并重启旧版本；恢复失败保留待完成记录。

普通激活要求当前网站健康；紧急回退允许当前网站已经停止或健康检查失败。当前自动化保守地限制为不改变入口、关键持久化实现和依赖的更新；不支持未经评审的任意数据库升级。所有生产切换只换代码，**不把旧备份覆盖到当前生产库**。新增文章不会因回退操作而被旧快照覆盖。

操作不会修改 DNS、Nginx、VPN、NewAPI、记录服务、容器或整机重启配置。`systemctl daemon-reload` 仅让 systemd 重新读取配置，不重启其他服务。旧 release、备份与隔离演练目录保留，工具没有清理命令。

## 回退与中断恢复

已成功激活后，需要回退时：

```sh
sudo -v && python3 ~/technical-notes/website-release.py rollback
```

回退读取上次成功记录，先备份当前内容，再验证目标旧版本能读取它，最后切换。若实际服务目录与成功记录不一致，停止并要求检查，避免把人工操作当成自动化历史。

若进程被强制终止，`status` 显示 `recoveryRequired: true`，检查网站状态后执行：

```sh
sudo -v && python3 ~/technical-notes/website-release.py recover
```

恢复此前网站配置和成功历史，健康验证通过后清除 pending。额外错误日志写入失败不会阻止尝试恢复。这里验证的是进程中断处理；没有承诺或演练主机断电后的文件系统持久性。

## 验收证据

- 本地 Windows：14 项测试中 13 通过、1 项 Linux 进程组测试跳过；服务器 Ubuntu：14/14 通过。
- 测试包含错误目标、持久化变更阻断、逻辑数据库变化、sudo 失败先停止、健康失败回退、故障版本无法启动时的完整回退预检、中断恢复、成功记录一致性、日志写入失败仍恢复、超时清理演练子进程。
- 服务器真实候选演练：253 篇、253 已发布、506 个原件引用，数据库完整性 ok；旧 URL 302、匿名私有接口 401、RSS 域名正确。
- 副本新增草稿后用旧代码恢复：254 篇、253 已发布，新增私有草稿保留。真实生产库没有写入该测试文章。
- 独立代码复核发现的故障回退门槛、日志一致性及诊断写入问题均已修复；最终无剩余重要问题。
- 已安装脚本 SHA-256：`9ea4b4175b5c357dc429541fda559f2623a045f6ca47604b6e21fafac01282e9`。
- 最终服务器预检记录：`runtime/deployments/20261026T163542Z-9d14c491/result.json`，状态 ready；对应生产快照 `backup-2026-10-26T16-35-42-000Z-93b5f49a`。预检后 `status` 返回 active=b9、recoveryRequired=false，公开 HTTPS 健康接口返回 ok=true、mode=html。
- 上述新快照已于北京时间 00:37:44 同步到既有本机离机目录，254 文件校验通过，`downloaded=true`、`healthy=true`。

### 正式激活后的独立核验

- 激活记录 `20261026T164111Z-4fcae1e8`：from=b9、to=b10-release-tools-20261027、status=active，完成时间 UTC `2026-10-26T16:41:22Z`。
- `website-release.py status` 返回当前新版本、recoveryRequired=false；systemd 为 active/running、ExecMainStatus=0、NRestarts=0。MainPID 对应进程的 `/proc/<pid>/cwd` 与新版本目录一致。
- 本机与公网 `/_health` 均返回 ok=true、mode=html。首页、分类、标签、归档、RSS、sitemap 为 200，旧 `/docs/` 为 302，匿名 `/api/html/notes` 为 401。
- 生产数据库只读检查 integrity=ok、htmlNotes=253。演练中新增的第 254 篇只存在于隔离副本。
- Nginx、Hysteria 状态仍为 active，网站 cron 入口与日程不变。未操作 NewAPI 或记录服务。
- 切换后执行现有 `production-backup.sh` 成功，新快照为 `backup-2026-10-26T16-42-38-790Z-23d2b047`，254 个清单文件，证明备份入口能从 systemd 选择新 release。
- 该快照于北京时间 00:43:21 下载至本机离机目录，254 文件、27,323,219 字节校验通过，healthy=true；本机 11 个有效快照、0 个无效快照。

生产 sudo/systemd 实际切换已验证；生产故障注入后的自动切回仍未演练，当前失败回退证据来自隔离检查和单元测试。本次没有修改应用业务代码，未重复运行全应用测试。TLS 真实续期、生产浏览器验收和整机故障演练仍为独立待办。
