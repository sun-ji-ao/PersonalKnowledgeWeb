# 第 2 批证据索引

最终结论见 [验收报告](../BATCH-02-ACCEPTANCE.md)，命令见 [工具使用说明](../CONVERSION-GUIDE.md)。用户授权后的 [浏览器视觉检查](./BROWSER-ACCEPTANCE.md)已完成，截图在会话中查看，逐项观测记录已保存。

- [final-tests.txt](./final-tests.txt)：最终完整套件 24/24 通过，含可选展示阶段日志。
- [source-manifest.json](./source-manifest.json)、[source-snapshot.zip](./source-snapshot.zip)、[environment.json](./environment.json)：24 个源码/配置文件的交付快照及哈希，不含数据库、密码、node_modules 或 npm 缓存。
- [unchanged-check.json](./unchanged-check.json)：253 篇旧文和 8 个原有运行时/回归文件未改动。
- [sample-selection.json](./sample-selection.json)、[legacy-final/report.json](./legacy-final/report.json)：10 篇真实抽样、9 ready / 1 review_required。
- [legacy-audit.json](./legacy-audit.json)：125 个代码块、31 个图表源码逐项对账。
- [contract-preview/report.json](./contract-preview/report.json)、[contract-audit.json](./contract-audit.json)：专门写作/缺图样例和 3 个公式的语义核验。

`legacy-preview`、`core-test.txt` 和 `render-debug.txt` 保留中间排查记录；最终测试结论只取 final-tests.txt。抽样输出先于最终展示预算从 10 秒调整为 30 秒生成，其内容已再次通过语义/规范化审计；不要把样本中的旧 limits 字段当作当前 API 配置。

源码恢复时将 ZIP 解压到新的空目录并比对 manifest，再按锁文件安装依赖；不要覆盖当前工作目录。这只是代码快照，不能替代第 3 批的数据联合备份。
