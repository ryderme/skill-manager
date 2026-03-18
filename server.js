const express = require('express')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

const app = express()
const PORT = process.env.PORT || 3456

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── 配置 ──────────────────────────────────────────────────────────────────────

const HOME = process.env.HOME
const CONFIG_PATH = path.join(__dirname, 'tools.json')

function expandHome(p) {
  return p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p
}

function loadConfig() {
  const base = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))

  const rawSkillsDir = base.skillsDir ?? '~/github'
  const skillsDirs = process.env.SKILLS_DIR
    ? process.env.SKILLS_DIR.split(',').map(s => expandHome(s.trim()))
    : Array.isArray(rawSkillsDir)
      ? rawSkillsDir.map(expandHome)
      : [expandHome(rawSkillsDir)]

  const tools = {}
  for (const [name, dir] of Object.entries(base.tools || {})) {
    const envKey = name.toUpperCase() + '_SKILLS'
    tools[name] = process.env[envKey] ? expandHome(process.env[envKey]) : expandHome(dir)
  }

  const excludeProjects = new Set(
    process.env.EXCLUDE_PROJECTS
      ? process.env.EXCLUDE_PROJECTS.split(',').map(s => s.trim())
      : (base.excludeProjects || [])
  )

  const rules = base.rules || {}

  return { skillsDirs, tools, excludeProjects, rules }
}

let config = loadConfig()
let SKILLS_DIRS = config.skillsDirs
let TOOLS = config.tools
let EXCLUDE_PROJECTS = config.excludeProjects
let RULES = config.rules

// 判断某个 skill 是否允许链接到某个工具
function isAllowed(skillName, tool) {
  const rule = RULES[skillName]
  if (!rule) return true
  if (rule.only) return rule.only.includes(tool)
  if (rule.exclude) return !rule.exclude.includes(tool)
  return true
}

// 将 rules 写回 tools.json
function saveRules(rules) {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  raw.rules = rules
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n')
  RULES = rules
}

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
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && depth > 0) continue
      if (depth === 0 && EXCLUDE_PROJECTS.has(entry.name)) continue
      walk(path.join(dir, entry.name), depth + 1)
    }
  }

  for (const dir of SKILLS_DIRS) walk(dir)
  return skills.sort()
}

function getSkillStatus(skillDir) {
  const name = path.basename(skillDir)
  const status = {}

  for (const [tool, toolDir] of Object.entries(TOOLS)) {
    if (!isAllowed(name, tool)) {
      status[tool] = 'blocked'
      continue
    }
    const target = path.join(toolDir, name)
    try {
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(target)
        const resolved = path.resolve(path.dirname(target), linkTarget)
        status[tool] = resolved === skillDir ? 'linked' : 'wrong'
      } else {
        status[tool] = 'directory'
      }
    } catch {
      status[tool] = 'missing'
    }
  }

  let description = ''
  try {
    const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
    const titleLine = content.split('\n').find(l => l.startsWith('# '))
    const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'))
    description = titleLine ? titleLine.replace(/^#\s*/, '').trim() : (firstLine || '').trim()
    if (description.length > 80) description = description.slice(0, 77) + '...'
  } catch {}

  const baseDir = SKILLS_DIRS.find(d => skillDir.startsWith(d + path.sep) || skillDir === d) || SKILLS_DIRS[0]
  const rel = path.relative(baseDir, skillDir)
  const group = rel.split(path.sep)[0]
  const standalone = group === path.basename(skillDir)

  return { name, path: skillDir, description, status, group, standalone }
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/skills', (req, res) => {
  try {
    const dirs = findSkillDirs()
    const skills = dirs.map(getSkillStatus)
    res.json({ skills, tools: Object.keys(TOOLS), rules: RULES })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 创建软链接
app.post('/api/skills/:name/link', (req, res) => {
  const { name } = req.params
  const { tool } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })
  if (!isAllowed(name, tool)) return res.status(403).json({ error: `${name} 已被规则限制，不允许链接到 ${tool}` })

  const dirs = findSkillDirs()
  const skillDir = dirs.find(d => path.basename(d) === name)
  if (!skillDir) return res.status(404).json({ error: '未找到 skill: ' + name })

  const toolDir = TOOLS[tool]
  const target = path.join(toolDir, name)

  try {
    fs.mkdirSync(toolDir, { recursive: true })
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

// 设置规则（block/unblock）
app.put('/api/skills/:name/rule', (req, res) => {
  const { name } = req.params
  const { tool, blocked } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const rules = { ...RULES }
  const allTools = Object.keys(TOOLS)

  if (blocked) {
    // 添加排除规则
    const existing = rules[name] || {}
    const excludeSet = new Set(existing.exclude || [])
    excludeSet.add(tool)
    // 如果排除了所有工具，用 exclude 表示；如果只允许部分，用 only
    const excluded = [...excludeSet]
    const allowed = allTools.filter(t => !excluded.includes(t))
    if (allowed.length === 0) {
      rules[name] = { exclude: excluded }
    } else if (allowed.length < excluded.length) {
      rules[name] = { only: allowed }
    } else {
      rules[name] = { exclude: excluded }
    }
    // 同时移除软链接
    try {
      const target = path.join(TOOLS[tool], name)
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink()) fs.unlinkSync(target)
    } catch {}
  } else {
    // 移除排除规则
    const existing = rules[name]
    if (existing) {
      if (existing.exclude) {
        const newExclude = existing.exclude.filter(t => t !== tool)
        if (newExclude.length === 0) delete rules[name]
        else rules[name] = { exclude: newExclude }
      } else if (existing.only) {
        const newOnly = [...existing.only, tool]
        if (newOnly.length === allTools.length) delete rules[name]
        else rules[name] = { only: newOnly }
      }
    }
  }

  try {
    saveRules(rules)
    res.json({ ok: true, rules })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 全量同步
app.post('/api/sync', (req, res) => {
  const scriptPath = path.join(__dirname, 'skill-sync.sh')
  if (!fs.existsSync(scriptPath)) return res.status(404).json({ error: '未找到 skill-sync.sh' })
  exec(`bash "${scriptPath}" sync 2>&1`, { timeout: 30000 }, (err, stdout) => {
    res.json({ ok: !err, output: stdout, error: err ? err.message : null })
  })
})

// 清理失效链接
app.post('/api/clean', (req, res) => {
  const scriptPath = path.join(__dirname, 'skill-sync.sh')
  exec(`bash "${scriptPath}" clean 2>&1`, { timeout: 10000 }, (err, stdout) => {
    res.json({ ok: !err, output: stdout, error: err ? err.message : null })
  })
})

app.listen(PORT, () => {
  console.log(`Skill Manager running at http://localhost:${PORT}`)
})
