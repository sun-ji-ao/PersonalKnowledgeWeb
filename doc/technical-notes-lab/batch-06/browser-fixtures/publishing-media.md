---
title: 发布与媒体浏览器验收
description: 检查技术笔记的发布版本、中文搜索和缺图补传。
category: 数据库
tags: [SQLite, 发布验收]
---

## 事务与检索

公开检索词：青竹事务。SQLite 保存正文修订，发布引用决定公开可见版本。

```sql
SELECT title FROM content_revisions WHERE id = 'published_revision';
```

## 公式与图表

行内公式 $\sqrt{x}+1$。

```mermaid
flowchart LR
 A[写作] --> B[草稿修订]
 B --> C[发布引用]
 C --> D[公开阅读]
```

## 缺失图片

![待补传的示意图](assets/architecture.png)

## 继续记录

这段文字用于检查正文与媒体替换后，历史修订是否仍可恢复。
