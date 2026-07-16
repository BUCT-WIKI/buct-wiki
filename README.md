# Buct Wiki

## 简介
Buct Wiki是一个由北京化工大学（Beijing University of Chemistry Technology）学生网络中心（SNC, Student Network Center）社团成员自主维护的百科网站。

# 文档规范

## MarkDown规范

文档遵循 [GitHub Flavored Markdown（GFM）](https://github.github.com/gfm/) 标准。

图片或其他资源请放置在当前文档同级目录的`assets/{{ 当前文档名 }}/`中，文件名需要有明确含义，例如

```text
校园生活/
├── 食堂.mdx
├── 宿舍.mdx
└── assets/
    ├── 食堂/
    │   ├── 食堂入口.jpg
    │   └── 菜单.png
    └── 宿舍/
        └── 宿舍环境.jpg
```

## FrontMatter规范

Frontmatter 位于文档开头的两行 `---` 之间，使用 YAML 语法。

| 字段 | 含义 | 值类型   | 是否必填 | 默认值 |
| --- | --- |-------| - | -- |
| `title` | 页面标题 | 字符串   | 是 | 无 |
| `description` | 页面内容的简短描述 | 字符串   | 否 | 无 |
| `template` | 页面布局 | 枚举字符串 | 否 | `doc` |
| `type` | 信息类型；非一般信息会在标题前显示对应标签 | 枚举字符串 | 否 | `general` |
| `tags` | 用于分类和检索页面的标签 | 无序列表  | 否 | 无 |
| `feedback` | 是否显示内容反馈入口 | 布尔值   | 否 | `true` |

### `template` 页面布局

| 值 | 含义 |
| --- | --- |
| `doc` | 标准文档页面，显示侧边栏 |
| `splash` | 宽屏页面，不显示侧边栏 |

### `type` 信息类型

| 值 | 含义 |
| --- | --- |
| `general` | 公开信息或一般信息 |
| `official` | 官方发布或可由官方来源确认的信息 |
| `experience` | 投稿者的个人经验或主观建议 |



示例：

```yaml
---
title: 学校官网
description: 北京化工大学学校官方网站汇总
type: official
tags:
  - 官网
  - 办事大厅
  - 教务系统
---
```
