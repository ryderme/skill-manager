# ⚡ Skill Manager

> **[中文文档](README.zh-CN.md)**

A web-based dashboard for managing AI coding tool skills via symlinks. Supports Claude Code, Codex, Cursor, OpenClaw and any other tool that loads skills from a directory.

![Hero](docs/screenshots/hero.png)

---

## What is this?

AI coding tools like Claude Code load "skills" (slash commands, agents, workflows) by scanning a local directory for folders containing a `SKILL.md` file. If you use multiple tools, you end up maintaining separate copies or manually symlinking the same skills into each tool's directory.

**Skill Manager** solves this: it scans your skill repositories, shows you which skills are linked to which tools, and lets you manage those symlinks from a single UI.

---

## Features

### Dashboard
- Skills grouped by project/repository with collapsible sections
- Per-tool link status: **linked** · **missing** · **blocked** · **wrong** · **directory**
- Header stats: total skills, projects, fully linked count
- Sidebar for quick group navigation and filtering

### Link Management
- **Click** a status badge to toggle link on/off
- **Right-click** a badge for full context menu (block, allow, fix, etc.)
- **Fix wrong symlinks** in one click when a link points to the wrong path
- **Batch operations**: check multiple skills → link/unlink to any tool at once

![Batch select](docs/screenshots/batch-select.png)

### Rules (3-level blocking)
| Level | Scope | Example use |
|-------|-------|-------------|
| Tool rule | All skills for one tool | Disable Codex entirely while evaluating |
| Group rule | All skills in a project group | Keep internal tools off Claude Code |
| Skill rule | One skill, one tool | Block a draft skill from all tools except one |

Allow-list exceptions: whitelist individual skills or whole groups from a global block.

### Filters
Filter the skill list by link completeness:

![Filter: fully linked](docs/screenshots/filter-linked.png)

- **All** — show everything
- **Fully linked** — linked to every tool
- **Partial** — linked to some tools but not all
- **None** — not linked to any tool

### Skill Detail Drawer
Click any skill name to open a side drawer showing the full `SKILL.md` content with basic markdown rendering.

![Detail drawer](docs/screenshots/detail-drawer.png)

### Sync & Clean
- **Sync all** — creates missing symlinks for all non-blocked skills, reports conflicts
- **Clean stale** — removes symlinks whose targets no longer exist on disk

### Delete
- **Soft delete** — removes symlinks and hides the skill from the list (recoverable)
- **Hard delete** — also removes the skill directory from disk
- Deleted skills appear in a recoverable list; restore with one click

### Other
- **Name conflict detection** — badge + warning when the same skill name exists in multiple directories
- **Group select-all** — checkbox in group header selects/deselects all skills in that group
- **Config hot reload** — edits to `tools.json` (e.g. by `npx skills add`) are picked up automatically without restarting

---

## Quick Start

```bash
git clone https://github.com/ryderme/skill-manager
cd skill-manager
npm install

# Copy and edit the config
cp tools.example.json tools.json
# Edit tools.json to point to your tools and skill directories

npm start
# Open http://localhost:3456
```

---

## Configuration

All configuration lives in `tools.json` in the project root.

```json
{
  "tools": {
    "claudecode": "~/.claude/skills",
    "codex":      "~/.codex/skills",
    "cursor":     "~/.cursor/skills"
  },
  "skillsDir": [
    "~/github",
    { "path": "~/.agents/skills", "group": ".agents" }
  ],
  "excludeProjects": ["skill-manager"],
  "rules": {
    "my-private-skill": { "exclude": ["codex"] }
  },
  "groupRules": {
    "internal-tools": { "only": ["claudecode"] }
  },
  "toolRules": {
    "codex": { "blockAll": true, "allow": ["my-approved-skill"] }
  },
  "deletedSkills": []
}
```

### `tools`
Map of tool name → directory where symlinks are created.

### `skillsDir`
Array of directories to scan for skills. Each entry is either:
- A string path (`"~/github"`) — immediate subdirectories become group names
- An object `{ "path": "...", "group": "name" }` — all skills under that path share a fixed group name

### `excludeProjects`
Project/directory names to skip during scanning.

### `rules`
Per-skill blocking:
```json
"my-skill": { "exclude": ["tool1", "tool2"] }
```

### `groupRules`
Per-group blocking:
```json
"my-group": { "only": ["claudecode"] }
"other-group": { "exclude": ["codex"] }
```

### `toolRules`
Global per-tool rules with optional allow-list exceptions:
```json
"codex": {
  "blockAll": true,
  "allow": ["skill-a"],
  "allowGroups": ["trusted-group"]
}
```

---

## Development

```bash
npm run dev            # watch mode (auto-restart on file changes)
npm test               # run test suite (77 tests)
npm run test:coverage  # with coverage report
```

Tests use Jest + supertest against a real Express app with a temporary filesystem — no database mocks. A Husky pre-commit hook runs the full test suite before every commit.

### Generating mock data for screenshots

```bash
node scripts/create-mock.js
# Then start the mock server on a separate port:
_TEST_CONFIG_PATH="/tmp/skill-manager-mock/tools.json" PORT=3457 node server.js
```

---

## Architecture

```
server.js          Entry point — starts Express on PORT (default 3456)
app.js             Express app — all API routes and config hot reload
lib/
  skillLogic.js    Pure functions: isAllowed, getSkillGroup, findSkillDirs
public/
  index.html       Single-file frontend (vanilla JS, no build step)
tools.json         Runtime config (gitignored, use tools.example.json as template)
```

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/skills` | List all skills with status per tool |
| GET | `/api/skills/:name/content` | SKILL.md content for the detail drawer |
| POST | `/api/skills/:name/link` | Create symlink |
| DELETE | `/api/skills/:name/link` | Remove symlink |
| DELETE | `/api/skills/:name` | Soft/hard delete skill |
| POST | `/api/skills/:name/restore` | Restore a soft-deleted skill |
| PUT | `/api/skills/:name/rule` | Update per-skill rule |
| PUT | `/api/groups/:group/rule` | Update per-group rule |
| PUT | `/api/tools/:tool/rule` | Update global tool rule |
| PUT | `/api/tools/:tool/allow` | Manage tool allow-list |
| POST | `/api/sync` | Sync all skills |
| POST | `/api/clean` | Remove dangling symlinks |
| POST | `/api/batch/link` | Batch link multiple skills |
| POST | `/api/batch/unlink` | Batch unlink multiple skills |
| DELETE | `/api/groups/:group` | Delete all skills in a group |

---

## License

MIT
