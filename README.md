# Skill Manager

统一管理 AI 编程工具（OpenClaw、Claude Code、Codex）的 skill 软链接。

## 功能

- 自动扫描 `~/github/` 下所有含 `SKILL.md` 的目录
- Web UI 查看每个 skill 在三个工具中的链接状态
- 一键切换单个 skill 的链接/取消链接
- 全量同步 + 清理失效链接

## 快速开始

```bash
git clone https://github.com/ryderme/skill-manager
cd skill-manager
npm install
npm start
# 打开 http://localhost:3456
```

## CLI 工具

```bash
# 同步所有 skill（新建缺失链接）
./skill-sync.sh

# 查看状态
./skill-sync.sh status

# 强制更新所有链接
./skill-sync.sh update

# 清理失效链接
./skill-sync.sh clean
```

## 支持的工具

| 工具 | Skill 目录 |
|------|-----------|
| OpenClaw | `~/.openclaw/skills/` |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |

## 排除项目

默认排除 `everything-claude-code`（由 ECC 自行管理）。
修改 `server.js` 和 `skill-sync.sh` 中的 `EXCLUDE_PROJECTS` 可自定义。
