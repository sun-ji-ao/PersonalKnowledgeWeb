# Mermaid 最小安全补丁

日期：2026-09-23。在新增编辑器依赖的 npm audit 中发现既有 Mermaid 11.16.0 的安全公告。本记录对应新站 `technical-notes-lab`，不修改原 Astro 项目的依赖。

## 核验与操作

升级前 `npm.cmd audit --json --cache .npm-cache` 返回 Mermaid 为唯一有公告的包：总体 moderate，5 条公告。返回的受影响版本范围如下（从当次工具输出摘录，不是完整原始 JSON）：

| 公告 | 受影响范围 | 级别 |
| --- | --- | --- |
| [配置 API 原型污染](https://github.com/advisories/GHSA-c4c3-pg64-4m4v) | `>=11.0.0-alpha.1 <11.16.1` | low |
| [图表 CSS 注入](https://github.com/advisories/GHSA-6x64-9x62-f2gx) | `>=11.0.0-alpha.1 <11.16.1` | moderate |
| [Architecture 原型污染](https://github.com/advisories/GHSA-3rrr-jr9j-h3q3) | `>=11.5.0 <11.16.1` | moderate |
| [XY Chart 无限循环](https://github.com/advisories/GHSA-2v8p-3f2j-5mp7) | `>=11.0.0-alpha.1 <11.16.1` | moderate |
| [Radar 图拒绝服务](https://github.com/advisories/GHSA-rhh3-jpg6-66xh) | `>=11.6.0 <11.16.1` | moderate |

npm 的通用 fixAvailable 推荐 11.17.2，但以上受影响范围均不含 11.16.1，因此选用最小补丁 11.16.1。执行：

```text
npm.cmd install --save-exact mermaid@11.16.1 --cache .npm-cache --fetch-retries=0 --fetch-timeout=20000
changed 1 package, and audited 276 packages in 9s
found 0 vulnerabilities
```

只更新新站 package.json/package-lock.json 中 Mermaid 直接依赖及其该包锁定记录，不运行 `npm audit fix`，不升级其他无关依赖。官方 npm 包元信息确认 `version=11.16.1`、`license=MIT`，证据见 [mermaid-patch-package.json](./mermaid-patch-package.json)。

升级后重新执行 audit，全部 info/low/moderate/high/critical 均为 0，退出码 0；完整输出见 [npm-audit-after.json](./npm-audit-after.json)。这一结论只代表该次 npm advisory 检查结果，不代表不存在未知漏洞。

## 展示版本与验证

展示使用 `lib/html-core.mjs:11` 的 `VERSIONS.renderer`，由 `lib/html-render.mjs` 写入修订。根代理已将 renderer 从 2.0.0 升到 2.0.1；schema/converter/sanitizer 不变，已有数据库修订不会随安装或启动重转。

`npm.cmd run build:editor` 通过，bundle 939.7 KB；4314 隔离服务保持运行，静态 vendor 路径读取更新后的包。根代理在依赖冻结后统一执行完整测试，并继续浏览器验收。此记录不提前宣称完整回归已通过。
