'use strict'

// RED phase: tests will fail until lib/skillLogic.js is created.

const path = require('path')
const { getSkillGroup } = require('../lib/skillLogic')

// getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })
// Returns the group name for a given skill directory.

describe('getSkillGroup — basic group resolution', () => {
  const skillsDirs = ['/home/user/github', '/home/user/work']
  const skillsDirGroups = {}

  test('returns the intermediate directory as group name for a nested skill', () => {
    // /home/user/github/myproject/my-skill → group is "myproject"
    const skillDir = '/home/user/github/myproject/my-skill'
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('myproject')
  })

  test('returns the skill directory name itself when skill is directly under skillsDir', () => {
    // /home/user/github/standalone-skill → group is "standalone-skill"
    const skillDir = '/home/user/github/standalone-skill'
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('standalone-skill')
  })

  test('resolves group from the correct skillsDir when multiple dirs are configured', () => {
    // /home/user/work/team/team-skill → group is "team"
    const skillDir = '/home/user/work/team/team-skill'
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('team')
  })

  test('returns first path segment of relative path when skill is deeply nested', () => {
    // /home/user/github/projectA/subdir/deep-skill → group is "projectA"
    const skillDir = '/home/user/github/projectA/subdir/deep-skill'
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('projectA')
  })
})

describe('getSkillGroup — skillsDirGroups override', () => {
  test('returns the override group name when skillsDir has an explicit group mapping', () => {
    const skillsDirs = ['/home/user/.agents/skills']
    const skillsDirGroups = { '/home/user/.agents/skills': '.agents' }
    const skillDir = '/home/user/.agents/skills/some-skill'
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('.agents')
  })

  test('returns override group even for deeply nested skill under mapped dir', () => {
    const skillsDirs = ['/mapped']
    const skillsDirGroups = { '/mapped': 'forced-group' }
    const skillDir = '/mapped/nested/skill-name'
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('forced-group')
  })

  test('does NOT use override group for a different skillsDir', () => {
    const skillsDirs = ['/home/user/github', '/home/user/.agents/skills']
    const skillsDirGroups = { '/home/user/.agents/skills': '.agents' }
    const skillDir = '/home/user/github/myproject/my-skill'
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('myproject')
  })
})

describe('getSkillGroup — fallback behaviour', () => {
  test('falls back to first skillsDir when skill path does not start with any skillsDir', () => {
    const skillsDirs = ['/home/user/github']
    const skillsDirGroups = {}
    // Path outside any known dir → falls back to SKILLS_DIRS[0]
    const skillDir = '/tmp/random/standalone'
    const result = getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })
    // relative path of /tmp/random/standalone from /home/user/github is ../../tmp/random/standalone
    // first segment is '..'
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  test('handles exact match of skillDir to a skillsDir entry', () => {
    const skillsDirs = ['/home/user/github']
    const skillsDirGroups = {}
    // skillDir is exactly one of the base dirs → relative is '.'
    const result = getSkillGroup('/home/user/github', { skillsDirs, skillsDirGroups })
    expect(typeof result).toBe('string')
  })
})

describe('getSkillGroup — path separator handling', () => {
  test('handles path.sep correctly in skill path matching', () => {
    const skillsDirs = [path.join('/base', 'skills')]
    const skillsDirGroups = {}
    const skillDir = path.join('/base', 'skills', 'groupA', 'skill-x')
    expect(getSkillGroup(skillDir, { skillsDirs, skillsDirGroups })).toBe('groupA')
  })
})
