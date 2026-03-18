'use strict'

const express = require('express')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const { isAllowed, getSkillGroup, findSkillDirs } = require('./lib/skillLogic')

const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── Config ────────────────────────────────────────────────────────────────────

const HOME = process.env.HOME
// Allow tests to inject a custom config path via env var.
const CONFIG_PATH = process.env._TEST_CONFIG_PATH || path.join(__dirname, 'tools.json')

function expandHome(p) {
  return p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p
}

function loadConfig() {
  const base = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))

  const rawSkillsDir = base.skillsDir ?? '~/github'
  const rawEntries = process.env.SKILLS_DIR
    ? process.env.SKILLS_DIR.split(',').map(s => s.trim())
    : Array.isArray(rawSkillsDir) ? rawSkillsDir : [rawSkillsDir]

  const skillsDirGroups = {}
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

let SKILLS_DIRS, SKILLS_DIR_GROUPS, TOOLS, EXCLUDE_PROJECTS, RULES, GROUP_RULES, TOOL_RULES, DELETED_SKILLS

function reloadConfig() {
  const config = loadConfig()
  SKILLS_DIRS = config.skillsDirs
  SKILLS_DIR_GROUPS = config.skillsDirGroups
  TOOLS = config.tools
  EXCLUDE_PROJECTS = config.excludeProjects
  RULES = config.rules
  GROUP_RULES = config.groupRules
  TOOL_RULES = config.toolRules
  DELETED_SKILLS = config.deletedSkills
}

reloadConfig()

// Watch tools.json for external changes (e.g. npx skills add)
if (!process.env._TEST_CONFIG_PATH) {
  let _watchDebounce = null
  fs.watch(CONFIG_PATH, () => {
    clearTimeout(_watchDebounce)
    _watchDebounce = setTimeout(() => {
      try { reloadConfig() } catch (err) { console.error('Config reload failed:', err.message) }
    }, 300)
  })
}

// ── Persistence helpers ────────────────────────────────────────────────────────

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

// ── Internal helpers using current config state ────────────────────────────────

function _isAllowed(skillName, tool, group) {
  return isAllowed(skillName, tool, group, { toolRules: TOOL_RULES, groupRules: GROUP_RULES, rules: RULES })
}

function _getSkillGroup(skillDir) {
  return getSkillGroup(skillDir, { skillsDirs: SKILLS_DIRS, skillsDirGroups: SKILLS_DIR_GROUPS })
}

function _findSkillDirs() {
  return findSkillDirs({
    skillsDirs: SKILLS_DIRS,
    deletedSkills: DELETED_SKILLS,
    excludeProjects: EXCLUDE_PROJECTS,
    fs,
  })
}

// ── Scan ───────────────────────────────────────────────────────────────────────

function getSkillStatus(skillDir) {
  const name = path.basename(skillDir)
  const group = _getSkillGroup(skillDir)
  const standalone = group === name
  const status = {}

  for (const [tool, toolDir] of Object.entries(TOOLS)) {
    if (!_isAllowed(name, tool, group)) {
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

// ── Delete helpers ─────────────────────────────────────────────────────────────

function doDeleteSkill(name, hardDelete) {
  // Search for the skill directory, bypassing the DELETED_SKILLS filter so
  // already-soft-deleted skills can still be hard-deleted if requested.
  const allDirs = []
  function walkAll(dir, depth) {
    if (depth > 5) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some(e => e.name === 'SKILL.md' && e.isFile())) { allDirs.push(dir); return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && depth > 0) continue
      walkAll(path.join(dir, entry.name), depth + 1)
    }
  }
  for (const d of SKILLS_DIRS) walkAll(d, 0)

  const skillDir = allDirs.find(d => path.basename(d) === name)
  if (!skillDir) return { error: '未找到 skill: ' + name }

  // Remove all symlinks pointing to this skill
  const removed = []
  for (const [tool, toolDir] of Object.entries(TOOLS)) {
    const target = path.join(toolDir, name)
    try {
      if (fs.lstatSync(target).isSymbolicLink()) { fs.unlinkSync(target); removed.push(tool) }
    } catch {}
  }

  // Soft-delete: persist to deletedSkills
  const deletedSkills = new Set(DELETED_SKILLS)
  deletedSkills.add(name)
  saveDeletedSkills(deletedSkills)

  // Hard-delete: remove the real directory
  if (hardDelete) {
    try {
      fs.rmSync(skillDir, { recursive: true, force: true })
    } catch (err) {
      return { ok: true, removed, softDeleted: true, hardDeleted: false, hardDeleteError: err.message, path: skillDir }
    }
  }
  return { ok: true, removed, softDeleted: true, hardDeleted: !!hardDelete, path: skillDir }
}

// ── API ────────────────────────────────────────────────────────────────────────

app.get('/api/skills', (req, res) => {
  try {
    const dirs = _findSkillDirs()
    // Detect name conflicts across skillsDirs
    const seen = {}
    const nameConflicts = {}
    for (const d of dirs) {
      const name = path.basename(d)
      if (seen[name]) {
        nameConflicts[name] = nameConflicts[name] || [seen[name]]
        nameConflicts[name].push(d)
      } else {
        seen[name] = d
      }
    }
    const skills = dirs.map(getSkillStatus)
    res.json({ skills, tools: Object.keys(TOOLS), rules: RULES, groupRules: GROUP_RULES, toolRules: TOOL_RULES, nameConflicts })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/deleted-skills', (req, res) => {
  // Walk all skillsDirs ignoring DELETED_SKILLS filter to find which deleted skills still exist on disk
  const allDirs = []
  function walkAll(dir, depth) {
    if (depth > 5) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    if (entries.some(e => e.name === 'SKILL.md' && e.isFile())) { allDirs.push(dir); return }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && depth > 0) continue
      walkAll(path.join(dir, entry.name), depth + 1)
    }
  }
  for (const d of SKILLS_DIRS) walkAll(d, 0)
  const onDisk = new Set(allDirs.map(d => path.basename(d)))
  const result = [...DELETED_SKILLS].map(name => ({ name, existsOnDisk: onDisk.has(name) }))
  res.json({ deletedSkills: result })
})

app.get('/api/skills/:name/content', (req, res) => {
  const { name } = req.params
  const dirs = _findSkillDirs()
  const skillDir = dirs.find(d => path.basename(d) === name)
  if (!skillDir) return res.status(404).json({ error: '未找到 skill: ' + name })
  try {
    const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
    res.json({ ok: true, name, content, path: skillDir })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/skills/:name/restore', (req, res) => {
  const { name } = req.params
  if (!DELETED_SKILLS.has(name)) return res.status(404).json({ error: `"${name}" 不在已删除列表中` })
  const updated = new Set(DELETED_SKILLS)
  updated.delete(name)
  saveDeletedSkills(updated)
  res.json({ ok: true, message: `已恢复 "${name}"，可重新链接` })
})

app.post('/api/skills/:name/link', (req, res) => {
  const { name } = req.params
  const { tool } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const dirs = _findSkillDirs()
  const skillDir = dirs.find(d => path.basename(d) === name)
  if (!skillDir) return res.status(404).json({ error: '未找到 skill: ' + name })

  const group = _getSkillGroup(skillDir)
  if (!_isAllowed(name, tool, group)) return res.status(403).json({ error: `${name} 已被规则限制，不允许链接到 ${tool}` })

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

app.delete('/api/skills/:name', (req, res) => {
  const { name } = req.params
  const { hardDelete } = req.body || {}
  const result = doDeleteSkill(name, hardDelete)
  if (result.error) return res.status(404).json(result)
  res.json(result)
})

app.delete('/api/groups/:group', (req, res) => {
  const { group } = req.params
  const { hardDelete } = req.body || {}

  const dirs = _findSkillDirs()
  const groupDirs = dirs.filter(d => _getSkillGroup(d) === group)
  if (groupDirs.length === 0) return res.status(404).json({ error: `未找到组: ${group}` })

  const results = []
  for (const skillDir of groupDirs) {
    const name = path.basename(skillDir)
    results.push({ name, ...doDeleteSkill(name, hardDelete) })
  }

  res.json({ ok: true, count: results.length, hardDeleted: !!hardDelete, results })
})

app.put('/api/skills/:name/rule', (req, res) => {
  const { name } = req.params
  const { tool, blocked } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const rules = { ...RULES }
  const allTools = Object.keys(TOOLS)

  if (blocked) {
    const existing = rules[name] || {}
    const excludeSet = new Set(existing.exclude || [])
    excludeSet.add(tool)
    const excluded = [...excludeSet]
    const allowed = allTools.filter(t => !excluded.includes(t))
    if (allowed.length === 0) {
      rules[name] = { exclude: excluded }
    } else if (allowed.length < excluded.length) {
      rules[name] = { only: allowed }
    } else {
      rules[name] = { exclude: excluded }
    }
    try {
      const target = path.join(TOOLS[tool], name)
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink()) fs.unlinkSync(target)
    } catch {}
  } else {
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

    const dirs = _findSkillDirs()
    for (const skillDir of dirs) {
      if (_getSkillGroup(skillDir) === group) {
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

app.put('/api/tools/:tool/rule', (req, res) => {
  const { tool } = req.params
  const { blockAll } = req.body

  if (!TOOLS[tool]) return res.status(400).json({ error: '未知工具: ' + tool })

  const toolRules = { ...TOOL_RULES }

  if (blockAll) {
    toolRules[tool] = { blockAll: true }
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

app.put('/api/tools/:tool/allow', (req, res) => {
  const { tool } = req.params
  const { type, name, allowed } = req.body

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

app.post('/api/sync', (req, res) => {
  const dirs = _findSkillDirs()
  const log = []
  let created = 0, skipped = 0, blocked = 0, warned = 0

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
    if (seen[name] !== skillDir) continue

    const group = _getSkillGroup(skillDir)

    for (const [tool, toolDir] of Object.entries(TOOLS)) {
      if (!_isAllowed(name, tool, group)) {
        blocked++
        continue
      }

      const target = path.join(toolDir, name)
      try { fs.mkdirSync(toolDir, { recursive: true }) } catch {}

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
        fs.statSync(target)
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

app.post('/api/batch/link', (req, res) => {
  const { items } = req.body
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items 必须是非空数组' })
  const unknown = items.map(i => i.tool).filter(t => !TOOLS[t])
  if (unknown.length) return res.status(400).json({ error: '未知工具: ' + [...new Set(unknown)].join(', ') })

  const dirs = _findSkillDirs()
  const results = items.map(({ name, tool }) => {
    const skillDir = dirs.find(d => path.basename(d) === name)
    if (!skillDir) return { name, tool, ok: false, error: '未找到 skill' }
    const group = _getSkillGroup(skillDir)
    if (!_isAllowed(name, tool, group)) return { name, tool, ok: false, error: '已被规则限制' }
    const target = path.join(TOOLS[tool], name)
    try {
      fs.mkdirSync(TOOLS[tool], { recursive: true })
      try { if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target) } catch {}
      fs.symlinkSync(skillDir, target)
      return { name, tool, ok: true }
    } catch (err) {
      return { name, tool, ok: false, error: err.message }
    }
  })
  res.json({ ok: true, results })
})

app.post('/api/batch/unlink', (req, res) => {
  const { items } = req.body
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items 必须是非空数组' })
  const unknown = items.map(i => i.tool).filter(t => !TOOLS[t])
  if (unknown.length) return res.status(400).json({ error: '未知工具: ' + [...new Set(unknown)].join(', ') })

  const results = items.map(({ name, tool }) => {
    const target = path.join(TOOLS[tool], name)
    try {
      if (!fs.lstatSync(target).isSymbolicLink()) return { name, tool, ok: false, error: '非软链接' }
      fs.unlinkSync(target)
      return { name, tool, ok: true }
    } catch {
      return { name, tool, ok: false, error: '链接不存在' }
    }
  })
  res.json({ ok: true, results })
})

module.exports = app
