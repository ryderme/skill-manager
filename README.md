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

## 自定义配置

通过环境变量覆盖默认路径，无需修改代码：

```bash
# skill 源码目录（默认 ~/github）
export SKILLS_DIR=~/projects

# 各工具的 skill 目录（有默认值，一般不需要改）
export OPENCLAW_SKILLS=~/.openclaw/skills
export CLAUDECODE_SKILLS=~/.claude/skills
export CODEX_SKILLS=~/.codex/skills

# 排除不扫描的项目（逗号分隔）
export EXCLUDE_PROJECTS=everything-claude-code,skill-manager
```

也可以写入 `.env` 文件（不会被提交）：

```bash
echo "SKILLS_DIR=~/projects" > .env
# 然后用 source .env && npm start 启动
```
