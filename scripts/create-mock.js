'use strict'

/**
 * Creates a self-contained mock environment for screenshots.
 * Run: node scripts/create-mock.js
 * Then: node server.js (with PORT=3457 and mock config)
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const MOCK_DIR = path.join(os.tmpdir(), 'skill-manager-mock')
const SKILLS_DIR = path.join(MOCK_DIR, 'skills')
const TOOLS = {
  claudecode: path.join(MOCK_DIR, 'tool-claudecode'),
  cursor:     path.join(MOCK_DIR, 'tool-cursor'),
  codex:      path.join(MOCK_DIR, 'tool-codex'),
}
const CONFIG_PATH = path.join(MOCK_DIR, 'tools.json')

// ── Skill content ─────────────────────────────────────────────────────────────

const SKILLS = [
  // my-saas-app group
  {
    group: 'my-saas-app', name: 'code-review',
    md: `# Code Review Assistant\nAutomated code review with best practices enforcement.\n\n## Features\n- Detects common anti-patterns\n- Suggests refactoring opportunities\n- Checks test coverage gaps\n- Reviews security vulnerabilities\n\n## Usage\nInvoke during PR review. Works best on diffs under 500 lines.\n\n\`\`\`bash\n# Example usage\nclaude review --diff HEAD~1\n\`\`\``,
    link: ['claudecode', 'cursor', 'codex'],
  },
  {
    group: 'my-saas-app', name: 'git-workflow',
    md: `# Git Workflow Manager\nStandardized git operations: branching, commit messages, PR creation.\n\n## Commands\n- \`/branch\` — create feature branch\n- \`/commit\` — conventional commit with scope\n- \`/pr\` — draft PR with summary\n\n## Conventions\nFollows Conventional Commits spec. Enforces linear history.`,
    link: ['claudecode', 'cursor'],
  },
  {
    group: 'my-saas-app', name: 'ci-deploy',
    md: `# CI/CD Deploy Helper\nManages deployment pipelines for staging and production.\n\n## Supported Platforms\n- GitHub Actions\n- AWS CodePipeline\n- Vercel\n\n## Workflows\n1. Run tests\n2. Build artifacts\n3. Deploy to staging\n4. Smoke test\n5. Promote to production`,
    link: ['claudecode'],
  },
  {
    group: 'my-saas-app', name: 'debug-helper',
    md: `# Debug Helper\nInteractive debugging assistant. Traces errors through stack frames and suggests fixes.\n\n## Usage\nPaste your error message and stack trace. The skill will:\n- Identify root cause\n- Suggest code fixes\n- Generate regression tests`,
    link: [],
  },

  // team-dashboard group
  {
    group: 'team-dashboard', name: 'slack-notifier',
    md: `# Slack Notifier\nSend formatted notifications to Slack channels.\n\n## Supported Message Types\n- Build status alerts\n- Deployment announcements\n- On-call escalations\n- Daily digest summaries\n\n## Configuration\nRequires \`SLACK_WEBHOOK_URL\` environment variable.`,
    link: ['claudecode', 'cursor', 'codex'],
  },
  {
    group: 'team-dashboard', name: 'jira-sync',
    md: `# Jira Sync\nBidirectional sync between code and Jira tickets.\n\nAutomatic updates when:\n- PR is opened → moves ticket to In Review\n- PR is merged → moves to Done, adds deployment note\n- Build fails → adds comment with error link`,
    link: ['claudecode', 'cursor'],
  },
  {
    group: 'team-dashboard', name: 'sprint-planner',
    md: `# Sprint Planner\nAI-assisted sprint planning: estimates, capacity checks, risk flags.\n\n## Workflow\n1. Load backlog from Jira\n2. Estimate story points per ticket\n3. Check team capacity\n4. Flag dependencies and blockers\n5. Generate sprint summary`,
    link: ['claudecode'],
    blocked: { cursor: true, codex: true },
  },

  // personal-tools group
  {
    group: 'personal-tools', name: 'daily-standup',
    md: `# Daily Standup Generator\nGenerates concise standup updates from git log and ticket activity.\n\nOutputs:\n- What I did yesterday\n- What I'm doing today\n- Blockers (if any)\n\nIntegrates with GitHub, Linear, and Jira.`,
    link: ['claudecode', 'codex'],
  },
  {
    group: 'personal-tools', name: 'meeting-notes',
    md: `# Meeting Notes Formatter\nFormats and summarizes meeting notes into structured action items.\n\n## Output Format\n- **Attendees**\n- **Key Decisions**\n- **Action Items** (owner, due date)\n- **Next Meeting**`,
    link: ['claudecode', 'cursor', 'codex'],
  },
  {
    group: 'personal-tools', name: 'focus-timer',
    md: `# Focus Timer (Pomodoro)\nPomodoro-style focus session manager integrated with task tracking.\n\n25 min focus → 5 min break → repeat.\nAuto-logs completed sessions to your task tracker.`,
    link: [],
  },

  // ai-workflows group
  {
    group: 'ai-workflows', name: 'prompt-engineer',
    md: `# Prompt Engineer\nOptimizes and tests LLM prompts for production use.\n\n## Features\n- A/B test prompt variants\n- Measure output quality\n- Auto-generate few-shot examples\n- Convert to structured output (JSON)\n\n## Supported Models\nWorks with Claude, GPT-4, Gemini, and open-source models.`,
    link: ['claudecode', 'cursor', 'codex'],
  },
  {
    group: 'ai-workflows', name: 'data-analyzer',
    md: `# Data Analyzer\nAnalyzes CSV/JSON datasets and generates insights with charts.\n\n## Capabilities\n- Statistical summaries\n- Correlation detection\n- Anomaly flagging\n- Trend visualization (outputs Mermaid or Chart.js)\n\n## Usage\nDrop a file or paste data, describe what you want to find.`,
    link: ['claudecode'],
  },
  {
    group: 'ai-workflows', name: 'code-explainer',
    md: `# Code Explainer\nExplains unfamiliar code in plain English with diagrams.\n\nSupports: Python, TypeScript, Go, Rust, Java, Ruby.\n\nOutputs:\n- Line-by-line explanation\n- Architecture diagram (ASCII)\n- Suggested improvements`,
    link: ['claudecode', 'cursor'],
  },
  {
    group: 'ai-workflows', name: 'test-generator',
    md: `# Test Generator\nGenerates comprehensive test suites from source code.\n\n## Test Types\n- Unit tests\n- Integration tests\n- Edge case scenarios\n- Property-based tests\n\nTargets 80%+ coverage by default. Configurable per project.`,
    link: [],
  },

  // learning group
  {
    group: 'learning', name: 'typescript-tips',
    md: `# TypeScript Tips & Patterns\nCurated TypeScript patterns for safer, more expressive code.\n\n## Topics\n- Discriminated unions\n- Template literal types\n- Conditional types\n- Mapped types\n- Branded types for domain modeling`,
    link: ['claudecode', 'cursor', 'codex'],
  },
  {
    group: 'learning', name: 'docker-basics',
    md: `# Docker Fundamentals\nEssential Docker knowledge: containers, images, compose.\n\n## Modules\n1. Images and layers\n2. Dockerfile best practices\n3. Multi-stage builds\n4. Docker Compose\n5. Networking\n6. Volumes and persistence`,
    link: ['claudecode'],
  },
  {
    group: 'learning', name: 'react-patterns',
    md: `# React Patterns\nModern React patterns: hooks, composition, performance.\n\n## Covered Patterns\n- Custom hook extraction\n- Compound components\n- Render props → hooks migration\n- Suspense and Error Boundaries\n- Context optimization`,
    link: [],
  },
]

// ── Setup ─────────────────────────────────────────────────────────────────────

function mkdirp(p) { fs.mkdirSync(p, { recursive: true }) }

function symlink(target, link) {
  try { fs.unlinkSync(link) } catch {}
  fs.symlinkSync(target, link)
}

console.log('Creating mock environment at', MOCK_DIR)
mkdirp(SKILLS_DIR)
for (const dir of Object.values(TOOLS)) mkdirp(dir)

for (const skill of SKILLS) {
  const skillDir = path.join(SKILLS_DIR, skill.group, skill.name)
  mkdirp(skillDir)
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill.md)

  for (const tool of skill.link) {
    symlink(skillDir, path.join(TOOLS[tool], skill.name))
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

const config = {
  tools: Object.fromEntries(Object.entries(TOOLS).map(([k,v]) => [k, v])),
  skillsDir: [SKILLS_DIR],
  excludeProjects: [],
  rules: {
    'ci-deploy':     { exclude: ['cursor', 'codex'] },
    'sprint-planner':{ exclude: ['cursor', 'codex'] },
    'debug-helper':  {},
  },
  groupRules: {
    'learning': { only: ['claudecode'] },
  },
  toolRules: {},
  deletedSkills: [],
}

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))

console.log('\n✓ Mock environment ready!')
console.log('\nStart mock server:')
console.log(`  _TEST_CONFIG_PATH="${CONFIG_PATH}" PORT=3457 node server.js`)
console.log('\nConfig:', CONFIG_PATH)
console.log('Skills dir:', SKILLS_DIR)
