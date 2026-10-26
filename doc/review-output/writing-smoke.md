---
title: 写作验收：一次保存与发布
description: 用于本地验收的示例文章，包含代码、公式和图表。
tags: [验收, Markdown]
---

# 写作验收：一次保存与发布

这篇示例用于验证 Markdown 写作、保存、预览和发布。

## 代码高亮

```c++
#include <iostream>
int main() {
    std::cout << "Hello, notes!" << std::endl;
    return 0;
}
```

## 数学公式

行内公式：$E = mc^2$。

$$
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
$$

## 写作流程

```mermaid
flowchart LR
    A[Markdown 写作] --> B[保存草稿]
    B --> C[发布文章]
    C --> D[读者阅读]
```

## 检查清单

- [x] Markdown 原文保留
- [x] 中文标题和段落正常
- [ ] 浏览器验收完成

| 项目 | 预期 |
| --- | --- |
| 草稿 | 仅作者可见 |
| 发布 | 阅读页立即更新 |
