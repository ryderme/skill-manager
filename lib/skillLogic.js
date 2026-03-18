'use strict'

const path = require('path')

/**
 * Determine whether a skill is allowed to be linked to a tool.
 *
 * Three-level priority (highest wins):
 *   1. Tool-level rules  (toolRules[tool].blockAll)
 *   2. Group-level rules (groupRules[group].only / .exclude)
 *   3. Skill-level rules (rules[skillName].only / .exclude)
 *
 * @param {string} skillName
 * @param {string} tool
 * @param {string|null} group
 * @param {{ toolRules: object, groupRules: object, rules: object }} context
 * @returns {boolean}
 */
function isAllowed(skillName, tool, group, context) {
  const { toolRules = {}, groupRules = {}, rules = {} } = context

  // 1. Tool-level blockAll
  const toolRule = toolRules[tool]
  if (toolRule && toolRule.blockAll) {
    if (toolRule.allow && toolRule.allow.includes(skillName)) return true
    if (toolRule.allowGroups && toolRule.allowGroups.includes(group)) return true
    return false
  }

  // 2. Group-level rules
  if (group) {
    const groupRule = groupRules[group]
    if (groupRule) {
      if (groupRule.only && !groupRule.only.includes(tool)) return false
      if (groupRule.exclude && groupRule.exclude.includes(tool)) return false
    }
  }

  // 3. Skill-level rules
  const rule = rules[skillName]
  if (!rule) return true
  if (rule.only) return rule.only.includes(tool)
  if (rule.exclude) return !rule.exclude.includes(tool)
  return true
}

/**
 * Return the group name for a skill directory.
 *
 * @param {string} skillDir  Absolute path to the skill directory.
 * @param {{ skillsDirs: string[], skillsDirGroups: object }} context
 * @returns {string}
 */
function getSkillGroup(skillDir, context) {
  const { skillsDirs = [], skillsDirGroups = {} } = context

  const baseDir =
    skillsDirs.find(d => skillDir.startsWith(d + path.sep) || skillDir === d) ||
    skillsDirs[0]

  if (baseDir && skillsDirGroups[baseDir]) return skillsDirGroups[baseDir]

  const rel = path.relative(baseDir, skillDir)
  return rel.split(path.sep)[0]
}

/**
 * Walk skillsDirs and collect all directories that contain a SKILL.md file.
 * Respects DELETED_SKILLS and EXCLUDE_PROJECTS.
 *
 * @param {{
 *   skillsDirs: string[],
 *   deletedSkills: Set<string>,
 *   excludeProjects: Set<string>,
 *   fs: { readdirSync: Function }
 * }} context
 * @returns {string[]} Sorted array of absolute paths.
 */
function findSkillDirs(context) {
  const { skillsDirs, deletedSkills, excludeProjects, fs: fsMod } = context
  const skills = []

  function walk(dir, depth) {
    if (depth > 5) return
    let entries
    try {
      entries = fsMod.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    const hasSkill = entries.some(e => e.name === 'SKILL.md' && e.isFile())
    if (hasSkill) {
      if (!deletedSkills.has(path.basename(dir))) skills.push(dir)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') && depth > 0) continue
      if (depth === 0 && excludeProjects.has(entry.name)) continue
      walk(path.join(dir, entry.name), depth + 1)
    }
  }

  for (const dir of skillsDirs) walk(dir, 0)
  return skills.sort()
}

module.exports = { isAllowed, getSkillGroup, findSkillDirs }
