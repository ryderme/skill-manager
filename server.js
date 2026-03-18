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
  const rawEntries = process.env.SKILLS_DIR
    ? process.env.SKILLS_DIR.split(',').map(s => s.trim())
    : Array.isArray(rawSkillsDir) ? rawSkillsDir : [rawSkillsDir]

  const skillsDirGroups = {}   // expanded path → group name override
  const skillsDirs = rawEntries.map(entry => {
    if (typeof entry === 'string') return expandHome(entry)
    const p = expandHome(entry.path)
    if (entry.group) skillsDirGroups[p] = entry.group
    return p
  })

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
  const groupRules = base.groupRules || {}
  const toolRules = base.toolRules || {}
  const deletedSkills = new Set(base.deletedSkills || [])

  return { skillsDirs, skillsDirGroups, tools, excludeProjects, rules, groupRules, toolRules, deletedSkills }
}

let config = loadConfig()
let SKILLS_DIRS = config.skillsDirs
let SKILLS_DIR_GROUPS = config.skillsDirGroups
let TOOLS = config.tools
let EXCLUDE_PROJECTS = config.excludeProjects
let RULES = config.rules
let GROUP_RULES = config.groupRules
let TOOL_RULES = config.toolRules
let DELETED_SKILLS = config.deletedSkills

// 判断某个 skill 是否允许链接到某个工具（三级优先级：tool > group > skill）
function isAllowed(skillName, tool, group) {
  // 1. Agent 全局屏蔽（白名单例外优先）
  const toolRule = TOOL_RULES[tool]
  if (toolRule && toolRule.blockAll) {
    if (toolRule.allow?.includes(skillName)) return true
    if (toolRule.allowGroups?.includes(group)) return true
    return false
  }

  // 2. 项目组屏蔽
  if (group) {
    const groupRule = GROUP_RULES[group]
    if (groupRule) {
      if (groupRule.only && !groupRule.only.includes(tool)) return false
      if (groupRule.exclude && groupRule.exclude.includes(tool)) return false
    }
  }

  // 3. Skill 级别屏蔽
  const rule = RULES[skillName]
  if (!rule) return true
  if (rule.only) return rule.only.includes(tool)
  if (rule.exclude) return !rule.exclude.includes(tool)
  return true
}

// 获取 skill 所属的项目组名
function getSkillGroup(skillDir) {
  const baseDir = SKILLS_DIRS.find(d => skillDir.startsWith(d + path.sep) || skillDir === d) || SKILLS_DIRS[0]
  if (SKILLS_DIR_GROUPS[baseDir]) return SKILLS_DIR_GROUPS[baseDir]
  const rel = path.relative(baseDir, skillDir)
  return rel.split(path.sep)[0]
}

// 将 rules 写回 tools.json
function saveRules(rules) {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  raw.rules = rules
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n')
  RULES = rules
}

function saveGroupRules(groupRules) {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  raw.groupRules = groupRules
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n')
  GROUP_RULES = groupRules
}

function saveToolRules(toolRules) {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  raw.toolRules = toolRules
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n')
  TOOL_RULES = toolRules
}

function saveDeletedSkills(deletedSkills) {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  raw.deletedSkills = [...deletedSkills]
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n')
  DELETED_SKILLS = deletedSkills
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
      if (!DELETED_SKILLS.has(path.basename(dir))) skills.push(dir)
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
  const group = getSkillGroup(skillDir)
  const standalone = group === name
  const status = {}

  for (const [tool, toolDir] of Object.entries(TOOLS)) {
    if (!isAllowed(name, tool, group)) {
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

  return { name, path: skillDir, description, status, group, standalone }
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/skills', (req, res) => {
  try {
    const dirs = findSkillDirs()
    const skills = dirs.map(getSkillStatus)
    res.json({ skills, tools: Object.keys(TOOLS), rules: RULES, groupRules: GROUP_RULES, toolRules: TOOL_RULES })
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

  const group = getSkillGroup(skillDir)
  if (!isAllowed(name, tool, group)) return res.status(403).json({ error: `${name} 已被规则限制，不允许链接到 ${tool}` })

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

// 删除单个 skill（软删：移除软链接+加入 deletedSkills；硬删：同时 rm -rf 真实目录）
function doDeleteSkill(name, hardDelete) {
  // 先在 deletedSkills 外找目录（已软删的可能已从扫描中排除，需直接搜）
  const allDirs = []
  function walkAll(dir, depth = 0) {
    if (depth > 5) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some(e => e.name === 'SKILL.md' && e.isFile())) { allDirs.push(dir); return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && depth > 0) continue
      walk(path.join(dir, entry.name), depth + 1)
    }
  }
  for (const d of SKILLS_DIRS) walkAll(d)
  const skillDir = allDirs.find(d => path.basename(d) === name)
  if (!skillDir) return { error: '未找到 skill: ' + name }

  // 移除所有软链接
  const removed = []
  for (const [tool, toolDir] of Object.entries(TOOLS)) {
    const target = path.join(toolDir, name)
    try {
      if (fs.lstatSync(target).isSymbolicLink()) { fs.unlinkSync(target); removed.push(tool) }
    } catch {}
  }

  // 加入 deletedSkills（软删）
  const deletedSkills = new Set(DELETED_SKILLS)
  deletedSkills.add(name)
  saveDeletedSkills(deletedSkills)

  // 硬删除：rm -rf 真实目录
  if (hardDelete) {
    try {
      fs.rmSync(skillDir, { recursive: true, force: true })
    } catch (err) {
      return { ok: true, removed, softDeleted: true, hardDeleted: false, hardDeleteError: err.message, path: skillDir }
    }
  }
  return { ok: true, removed, softDeleted: true, hardDeleted: !!hardDelete, path: skillDir }
}

app.delete('/api/skills/:name', (req, res) => {
  const { name } = req.params
  const { hardDelete } = req.body || {}
  const result = doDeleteSkill(name, hardDelete)
  if (result.error) return res.status(404).json(result)
  res.json(result)
})

// 删除整组 skill
app.delete('/api/groups/:group', (req, res) => {
  const { group } = req.params
  const { hardDelete } = req.body || {}

  const dirs = findSkillDirs()
  const groupDirs = dirs.filter(d => getSkillGroup(d) === group)
  if (groupDirs.length === 0) return res.status(404).json({ error: `未找到组: ${group}` })

  const results = []
  for (const skillDir of groupDirs) {
    const name = path.basename(skillDir)
    results.push({ name, ...doDeleteSkill(name, hardDelete) })
  }

  res.json({ ok: true, count: results.length, hardDeleted: !!hardDelete, results })
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

// 设置项目组规则
app.put('/api/groups/:group/rule', (req, res) => {
  const { group } = req.params
  const { tool, blocked } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const groupRules = { ...GROUP_RULES }
  const allTools = Object.keys(TOOLS)

  if (blocked) {
    const existing = groupRules[group] || {}
    const excludeSet = new Set(existing.exclude || [])
    excludeSet.add(tool)
    const excluded = [...excludeSet]
    const allowed = allTools.filter(t => !excluded.includes(t))
    groupRules[group] = allowed.length < excluded.length ? { only: allowed } : { exclude: excluded }

    // 移除该组下所有 skill 在此工具的软链接
    const dirs = findSkillDirs()
    for (const skillDir of dirs) {
      if (getSkillGroup(skillDir) === group) {
        try {
          const target = path.join(TOOLS[tool], path.basename(skillDir))
          const stat = fs.lstatSync(target)
          if (stat.isSymbolicLink()) fs.unlinkSync(target)
        } catch {}
      }
    }
  } else {
    const existing = groupRules[group]
    if (existing) {
      if (existing.exclude) {
        const newExclude = existing.exclude.filter(t => t !== tool)
        if (newExclude.length === 0) delete groupRules[group]
        else groupRules[group] = { exclude: newExclude }
      } else if (existing.only) {
        const newOnly = [...existing.only, tool]
        if (newOnly.length >= allTools.length) delete groupRules[group]
        else groupRules[group] = { only: newOnly }
      }
    }
  }

  try {
    saveGroupRules(groupRules)
    res.json({ ok: true, groupRules })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 设置 agent 全局规则（屏蔽所有 skill）
app.put('/api/tools/:tool/rule', (req, res) => {
  const { tool } = req.params
  const { blockAll } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const toolRules = { ...TOOL_RULES }

  if (blockAll) {
    toolRules[tool] = { blockAll: true }
    // 移除该工具的所有软链接
    const toolDir = TOOLS[tool]
    try {
      const entries = fs.readdirSync(toolDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          try { fs.unlinkSync(path.join(toolDir, entry.name)) } catch {}
        }
      }
    } catch {}
  } else {
    delete toolRules[tool]
  }

  try {
    saveToolRules(toolRules)
    res.json({ ok: true, toolRules })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 在全局屏蔽中为单个 skill 或组开白名单（例外）
app.put('/api/tools/:tool/allow', (req, res) => {
  const { tool } = req.params
  const { type, name, allowed } = req.body   // type: 'skill'|'group', name, allowed: bool

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })
  if (!['skill', 'group'].includes(type)) return res.status(400).json({ error: 'type 必须是 skill 或 group' })

  const toolRules = { ...TOOL_RULES }
  const rule = { ...(toolRules[tool] || {}) }
  const field = type === 'skill' ? 'allow' : 'allowGroups'
  const list = new Set(rule[field] || [])

  if (allowed) {
    list.add(name)
  } else {
    list.delete(name)
  }

  if (list.size > 0) {
    rule[field] = [...list]
  } else {
    delete rule[field]
  }
  toolRules[tool] = rule

  try {
    saveToolRules(toolRules)
    res.json({ ok: true, toolRules })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 全量同步（服务端实现，完整应用三级屏蔽规则）
app.post('/api/sync', (req, res) => {
  const dirs = findSkillDirs()
  const log = []
  let created = 0, skipped = 0, blocked = 0, warned = 0

  // 检测名称冲突
  const seen = {}
  for (const skillDir of dirs) {
    const name = path.basename(skillDir)
    if (seen[name]) {
      log.push(`[warn]  名称冲突: "${name}"，跳过 ${skillDir}`)
      warned++
    } else {
      seen[name] = skillDir
    }
  }

  for (const skillDir of dirs) {
    const name = path.basename(skillDir)
    if (seen[name] !== skillDir) continue   // 跳过冲突项

    const group = getSkillGroup(skillDir)

    for (const [tool, toolDir] of Object.entries(TOOLS)) {
      if (!isAllowed(name, tool, group)) {
        blocked++
        continue
      }

      const target = path.join(toolDir, name)
      try {
        fs.mkdirSync(toolDir, { recursive: true })
      } catch {}

      try {
        const stat = fs.lstatSync(target)
        if (stat.isSymbolicLink()) {
          const resolved = path.resolve(path.dirname(target), fs.readlinkSync(target))
          if (resolved === skillDir) {
            skipped++
          } else {
            log.push(`[warn]  ${tool}/${name} 指向不同路径，跳过（请手动处理）`)
            warned++
          }
        } else {
          log.push(`[warn]  ${tool}/${name} 已存在（非软链接），跳过`)
          warned++
        }
      } catch {
        try {
          fs.symlinkSync(skillDir, target)
          created++
          log.push(`[ok]    新建 ${tool}/${name}`)
        } catch (err) {
          log.push(`[err]   ${tool}/${name}: ${err.message}`)
          warned++
        }
      }
    }
  }

  log.push(`\n完成: 新建 ${created}，已有 ${skipped}，屏蔽跳过 ${blocked}，警告 ${warned}`)
  res.json({ ok: true, output: log.join('\n') })
})

// 清理失效链接
app.post('/api/clean', (req, res) => {
  const log = []
  let cleaned = 0

  for (const [tool, toolDir] of Object.entries(TOOLS)) {
    let entries
    try { entries = fs.readdirSync(toolDir, { withFileTypes: true }) }
    catch { continue }

    for (const entry of entries) {
      if (!entry.isSymbolicLink()) continue
      const target = path.join(toolDir, entry.name)
      try {
        fs.statSync(target)  // 如果 target 不存在会抛异常
      } catch {
        try {
          fs.unlinkSync(target)
          cleaned++
          log.push(`[ok]    删除失效链接: ${tool}/${entry.name}`)
        } catch (err) {
          log.push(`[err]   ${tool}/${entry.name}: ${err.message}`)
        }
      }
    }
  }

  log.push(`\n清理完成，删除 ${cleaned} 个失效链接`)
  res.json({ ok: true, output: log.join('\n') })
})

app.listen(PORT, () => {
  console.log(`Skill Manager running at http://localhost:${PORT}`)
})
