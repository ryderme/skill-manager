const express = require('express')
const fs = require('fs')
const path = require('path')
const { execSync, exec } = require('child_process')

const app = express()
const PORT = process.env.PORT || 3456

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── 配置 ──────────────────────────────────────────────────────────────────────

const HOME = process.env.HOME
const GITHUB_DIR = process.env.SKILLS_DIR || path.join(HOME, 'github')

const TOOLS = {
  openclaw:   process.env.OPENCLAW_SKILLS  || path.join(HOME, '.openclaw/skills'),
  claudecode: process.env.CLAUDECODE_SKILLS || path.join(HOME, '.claude/skills'),
  codex:      process.env.CODEX_SKILLS     || path.join(HOME, '.codex/skills'),
}

// 排除不扫描的项目（逗号分隔，或使用默认值）
const EXCLUDE_PROJECTS = new Set(
  process.env.EXCLUDE_PROJECTS
    ? process.env.EXCLUDE_PROJECTS.split(',').map(s => s.trim())
    : ['everything-claude-code', 'skill-manager']
)

// ── 扫描逻辑 ──────────────────────────────────────────────────────────────────

function findSkillDirs() {
  const skills = []

  function walk(dir, depth = 0) {
    if (depth > 5) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
    catch { return }

    const hasSkill = entries.some(e => e.name === 'SKILL.md' && e.isFile())
    if (hasSkill) {
      skills.push(dir)
      return // 不递归进已经是 skill 的目录
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && depth > 0) continue

      // 根层级跳过排除项目
      if (depth === 0 && EXCLUDE_PROJECTS.has(entry.name)) continue

      walk(path.join(dir, entry.name), depth + 1)
    }
  }

  walk(GITHUB_DIR)
  return skills.sort()
}

function getSkillStatus(skillDir) {
  const name = path.basename(skillDir)
  const status = {}

  for (const [tool, toolDir] of Object.entries(TOOLS)) {
    const target = path.join(toolDir, name)
    try {
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(target)
        const resolved = path.resolve(path.dirname(target), linkTarget)
        status[tool] = resolved === skillDir ? 'linked' : 'wrong'
      } else {
        status[tool] = 'directory' // 实体目录，非软链接
      }
    } catch {
      status[tool] = 'missing'
    }
  }

  // 读取 SKILL.md 的第一行作为描述
  let description = ''
  try {
    const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
    const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'))
    const titleLine = content.split('\n').find(l => l.startsWith('# '))
    description = titleLine ? titleLine.replace(/^#\s*/, '').trim() : (firstLine || '').trim()
    if (description.length > 80) description = description.slice(0, 77) + '...'
  } catch {}

  return { name, path: skillDir, description, status }
}

// ── API ───────────────────────────────────────────────────────────────────────

// 获取所有 skill 状态
app.get('/api/skills', (req, res) => {
  try {
    const dirs = findSkillDirs()
    const skills = dirs.map(getSkillStatus)
    res.json({ skills, tools: Object.keys(TOOLS) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 创建软链接
app.post('/api/skills/:name/link', (req, res) => {
  const { name } = req.params
  const { tool } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const dirs = findSkillDirs()
  const skillDir = dirs.find(d => path.basename(d) === name)
  if (!skillDir) return res.status(404).json({ error: '未找到 skill: ' + name })

  const toolDir = TOOLS[tool]
  const target = path.join(toolDir, name)

  try {
    fs.mkdirSync(toolDir, { recursive: true })

    // 如果已存在软链接则先删除
    try {
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink()) fs.unlinkSync(target)
      else return res.status(409).json({ error: '目标已存在且非软链接，请手动处理' })
    } catch {}

    fs.symlinkSync(skillDir, target)
    res.json({ ok: true, message: `已链接 ${tool}/${name}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 删除软链接
app.delete('/api/skills/:name/link', (req, res) => {
  const { name } = req.params
  const { tool } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const target = path.join(TOOLS[tool], name)

  try {
    const stat = fs.lstatSync(target)
    if (!stat.isSymbolicLink()) return res.status(409).json({ error: '非软链接，不能删除' })
    fs.unlinkSync(target)
    res.json({ ok: true, message: `已移除 ${tool}/${name}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 全量同步（调用 skill-sync.sh）
app.post('/api/sync', (req, res) => {
  const scriptPath = path.join(GITHUB_DIR, 'skill-sync.sh')
  if (!fs.existsSync(scriptPath)) {
    return res.status(404).json({ error: '未找到 skill-sync.sh' })
  }

  exec(`bash "${scriptPath}" sync 2>&1`, { timeout: 30000 }, (err, stdout) => {
    res.json({ ok: !err, output: stdout, error: err ? err.message : null })
  })
})

// 清理失效链接
app.post('/api/clean', (req, res) => {
  const scriptPath = path.join(GITHUB_DIR, 'skill-sync.sh')
  exec(`bash "${scriptPath}" clean 2>&1`, { timeout: 10000 }, (err, stdout) => {
    res.json({ ok: !err, output: stdout, error: err ? err.message : null })
  })
})

// ── 启动 ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Skill Manager running at http://localhost:${PORT}`)
})
