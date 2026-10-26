# 服务器共存服务与操作边界

更新于 2026-10-02。记录服务信息来自用户提供的部署和使用说明，本轮未连接服务器核验其配置、状态或请求链路。

## 服务清单

| 服务 | 已知入口/目录 | 使用范围 |
| --- | --- | --- |
| 技术笔记网站 | Nginx TCP 443 → Node 127.0.0.1:4310；/home/sunjiao/technical-notes | sunjiao.me 公开网站 |
| VPN | Hysteria2 UDP 443 | 保持现有配置 |
| VPN 订阅 | TCP 8080 | 保持现有订阅服务 |
| NewAPI | TCP 3000 | 保持现有网关配置和请求链路 |
| codex-recorder | /home/sunjiao/codex-recorder；服务器管理入口 127.0.0.1:18180 | 仅公司办公电脑使用；本机不使用 |

记录代理对公司网关转发的 ChatGPT/Codex 请求进行按开关记录。代理业务入口及其与 NewAPI 的具体转发配置未在本次说明中完整提供，不能将 18180 当作业务代理端口，也不能假定 NewAPI 3000 未经代理。

## 网站后续开发与部署边界

- 网站程序、内容与运行数据限于 /home/sunjiao/technical-notes，以及网站自身的 systemd、环境变量和 Nginx 站点配置。
- 保留 codex-recorder 的 Docker Compose 项目、容器、网络、端口、卷、部署环境和转发链路。网站操作不得执行其 stage/cutover、开关切换或容器停止/重建。
- 故障演练只针对 technical-notes 服务；整机重启、Docker 守护进程重启、全局容器清理会涉及共存服务，应作为独立操作安排。
- 网站备份继续只处理网站内容，不能把 codex-recorder 的 records、policies 或 secrets 下载到本机、复制到网站备份、提交 Git 或放入公开网站。用户说明“仅公司电脑使用”不构成任何访问公司记录内容的授权。
- 修改共享 Nginx 配置时核对现有站点并执行语法检查；VPN UDP 443、订阅 TCP 8080、NewAPI TCP 3000 和记录服务访问链路都属于需保留的共存配置。

## 记录服务日常使用（仅公司办公电脑）

使用保存了本地转发的 Xshell 会话：公司电脑 127.0.0.1:19180 → 服务器 127.0.0.1:18180。连接后保持会话在线，在公司电脑打开 http://127.0.0.1:19180/，用现有管理密码登录。

按需选择时长、开启本人 owner 密钥开关和记录总开关。若 Codex 已运行，开启后重新建立会话，让可能复用的 WebSocket 连接取得新的记录许可。用完关闭总开关。关闭浏览器、Windows 关机或 SSH 隧道断开不会主动关闭服务器记录开关。

日常使用无需重新部署、重新登记已保存的密钥指纹或再次 cutover。云服务器重启时，在 Docker 正常自启且容器此前未手动停止的前提下，restart: unless-stopped 应恢复容器；按用户说明，服务重启后总开关和密钥开关回到 OFF，已保存指纹、管理密码及保留期内记录仍在。

仅在公司电脑排查隧道：

```powershell
curl.exe --noproxy "*" -i --max-time 5 http://127.0.0.1:19180/healthz
```

在服务器终端排查管理服务：

```sh
curl --noproxy '*' -i --max-time 5 http://127.0.0.1:18180/healthz
cd /home/sunjiao/codex-recorder
sudo docker compose --project-name codex-recorder --env-file runtime/deploy.env -f compose.yaml ps
```

healthz 正常预期为 HTTP 200 和 {"ok":true}。服务器正常而公司电脑失败时先检查 Xshell 隧道；服务器也失败时检查容器状态，不重复 stage/cutover。

## 数据位置与保留

| 服务器路径（相对 /home/sunjiao/codex-recorder） | 用途 |
| --- | --- |
| runtime/data/records/ | AES-256-GCM 加密 .enc 请求记录，ID 对应管理页面详情 |
| runtime/data/policies.json | 密钥匹配策略与指纹 |
| runtime/secrets/encryption.hex | 记录加密密钥 |
| runtime/secrets/hmac.hex | 指纹计算密钥 |
| runtime/secrets/admin-password | 管理密码；网站操作不读取其内容 |
| runtime/deployment.json | 部署状态 |
| runtime/deploy.env、compose.yaml | Compose 部署配置 |

按用户说明，记录只包含开关开启期间、符合条件并实际经过代理的请求内容，包括上传的代码、文本及工具结果片段；不因此保存未上传本地文件、关闭期间请求或完整模型回复。

默认保留 7 天，加密记录总容量上限 1 GiB，数量约 2000 条，达到限制优先清理较旧记录。关闭开关不主动删除记录，但保留策略仍生效。

网站联合备份不覆盖记录服务。若以后单独安排记录服务长期备份，需要配套保存 runtime/data/ 与 runtime/secrets/；丢失 encryption.hex 将无法解密 .enc。备份目的地、权限和恢复演练需在记录服务任务中安排；本轮没有执行此备份，也没有在本机建立隧道或访问管理页面。
