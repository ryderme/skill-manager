---
title: 我用一个脚本，统一管理了三个 AI 编程工具的 Skill
author: Ryder
date: 2026-03-18
---

一、

最近一年，AI 编程工具扩张得很快。

我自己就在同时用 Claude Code、OpenClaw 和 Codex。三个工具各有擅长，切换起来还算顺手。但有一件事一直让我很烦：**Skill 要装三遍。**

每次写了一个新 Skill，比如"把文章发到微信公众号"，我要分别把它注册进三个工具的 Skill 目录。更新的时候，三个地方都要改。哪次忘了，就会出现"明明昨天刚改了逻辑，怎么这个工具里还是旧版本"的问题。

这不是效率问题，是心智负担问题。

二、

问题的根源在于：**Skill 文件散在各处，工具之间没有共享机制。**

- Claude Code 读 `~/.claude/skills/`
- OpenClaw 读 `~/.openclaw/skills/`
- Codex 读 `~/.codex/skills/`

三个目录，互不相知。如果你的 Skill 源码放在 GitHub 项目里，要用就得手动复制或者单独配置符号链接。

我查过现有方案。dotfiles 管理工具（stow、chezmoi）是管配置文件的，不是专门管 Skill 目录的。手动写符号链接可以解决问题，但一旦 Skill 多了，管理本身又成了问题。

三、

后来我写了一个脚本和一个 Web 管理界面，叫 [skill-manager](https://github.com/ryderme/skill-manager)。

核心思路很简单：把所有 Skill 的源码放在 `~/github/` 目录下，用符号链接把它们指向各个工具的 Skill 目录。这样每个 Skill 只有一份源码，三个工具共享同一份。改一次，三个工具同时生效。

我把它分成两部分：

**CLI 脚本（skill-sync.sh）**，用来自动发现和同步：

```bash
# 同步所有 Skill（自动创建缺失的符号链接）
./skill-sync.sh

# 查看每个 Skill 在三个工具中的链接状态
./skill-sync.sh status

# 清理已失效的符号链接
./skill-sync.sh clean
```

脚本会扫描目录下所有包含 `SKILL.md` 的子目录，识别为一个 Skill，然后在三个工具目录里各创建一条符号链接指向它。新增 Skill 之后跑一次，三个工具同时生效。

**Web 管理界面**，用来可视化和操作：

启动 `npm start` 之后，打开浏览器就能看到一张表格——所有 Skill 按来源项目分组，横轴是三个工具，每个格子显示链接状态。点格子可以直接创建或移除链接，不需要去终端敲命令。

四、

有几个地方想多说两句。

**符号链接对 Skill 本身完全透明。** 可以把它理解成桌面快捷方式：三个工具各有一个快捷方式，指向同一个真实文件。Skill 读写自己的配置时，操作的是源文件，三个工具共享同一份，不会出现"在 Claude Code 里配了，OpenClaw 里还要再配一遍"的情况。

**工具列表通过配置文件管理，不写死在代码里。** 加一个新工具，只需要在 `tools.json` 里加一行：

```json
{
  "tools": {
    "openclaw":   "~/.openclaw/skills",
    "claudecode": "~/.claude/skills",
    "codex":      "~/.codex/skills",
    "newtool":    "~/.newtool/skills"
  }
}
```

重新同步，新工具立刻生效。

**Skill 来源不限结构。** 无论是一个项目只有一个 Skill，还是一个项目下有十几个 Skill，脚本都能正确识别。Web 界面会按来源项目分组展示，一眼能看出哪些是同一个主题的 Skill。

五、

这件事让我重新想了想 AI 工具的使用习惯。

工具本身越来越多，切换成本越来越低。但 Skill 这层"积累"，是你在这些工具里反复提炼的能力。如果每次换工具都要重新安装、重新配置，这层积累就很难真正沉淀下来。

统一管理 Skill 不只是减少重复劳动，更重要的是让这层能力真正变成自己的资产——放在 Git 仓库里，版本可追溯，换机器可迁移，换工具也不用重来。

项目地址：[github.com/ryderme/skill-manager](https://github.com/ryderme/skill-manager)
