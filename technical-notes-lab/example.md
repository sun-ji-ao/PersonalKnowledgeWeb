---
title: 把理解写下来：我的技术笔记工作流
description: 从一个问题出发，用代码、公式和图表记录推理的过程。这是一篇可编辑的示例笔记。
tags: [写作方法, Markdown]
---

每次真正理解一个概念，往往都始于一个具体的问题。笔记的意义，是把那些容易消散的思考留下来，让下一次探索有一个起点。

## 01 / 从问题开始

不要急着整理百科全书。先写下今天碰到的问题、尝试过的方法，以及最终理解了什么。

> 一篇有用的笔记，应该让未来的自己少走一次弯路。

## 02 / 让代码说话

下面的二分查找将搜索区间逐步缩小。明确循环不变量，比记住代码更重要。

```javascript
function binarySearch(items, target) {
  let left = 0;
  let right = items.length - 1;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (items[mid] === target) return mid;
    if (items[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  return -1;
}
```

每轮将候选范围减半，时间复杂度为 $O(\log n)$。经过 $k$ 轮之后：

$$
\frac{n}{2^k} \leq 1 \quad \Longrightarrow \quad k \geq \log_2 n
$$

## 03 / 把关系画出来

```mermaid
flowchart LR
  A[遇到问题] --> B[动手验证]
  B --> C[记录理解]
  C --> D[公开分享]
  D --> A
```

## 04 / 留给下一次探索

| 记录什么 | 为什么有用 |
| --- | --- |
| 问题和背景 | 保留推理的起点 |
| 可运行的最小代码 | 让结论可以验证 |
| 失败的尝试 | 避免重复走弯路 |

- [x] 写下具体问题
- [x] 用示例验证理解
- [ ] 下次补充更多边界条件

这篇示例可在写作台直接编辑，也可以撤回发布。你的草稿只有登录后才能看到。
