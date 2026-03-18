'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const request = require('supertest')

let tmpDir, skillsDir, toolDir, configPath

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function makeSkill(name, underDir) {
  const dir = path.join(underDir || skillsDir, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\nTest skill.`)
  return dir
}

function makeSymlink(skillDir, toolTarget, skillName) {
  const link = path.join(toolTarget, skillName)
  try { fs.unlinkSync(link) } catch {}
  fs.symlinkSync(skillDir, link)
  return link
}

describe('POST /api/sync', () => {
  let app

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-sync-test-'))
    skillsDir = path.join(tmpDir, 'skills')
    toolDir = path.join(tmpDir, 'tool-claudecode')
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.mkdirSync(toolDir, { recursive: true })

    configPath = path.join(tmpDir, 'tools.json')
    writeConfig({
      tools: { claudecode: toolDir },
      skillsDir: [skillsDir],
      excludeProjects: [],
      rules: {},
      groupRules: {},
      toolRules: {},
      deletedSkills: [],
    })

    jest.resetModules()
    process.env.SKILLS_DIR = skillsDir
    process.env.CLAUDECODE_SKILLS = toolDir
    process.env._TEST_CONFIG_PATH = configPath
    app = require('../app')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.SKILLS_DIR
    delete process.env.CLAUDECODE_SKILLS
    delete process.env._TEST_CONFIG_PATH
  })

  test('creates symlinks for all skills', async () => {
    makeSkill('alpha')
    makeSkill('beta')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(fs.lstatSync(path.join(toolDir, 'alpha')).isSymbolicLink()).toBe(true)
    expect(fs.lstatSync(path.join(toolDir, 'beta')).isSymbolicLink()).toBe(true)
    expect(res.body.output).toMatch(/新建 2/)
  })

  test('is idempotent — skips already linked skills', async () => {
    const alphaDir = makeSkill('alpha')
    makeSymlink(alphaDir, toolDir, 'alpha')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(res.body.output).toMatch(/新建 0/)
    expect(res.body.output).toMatch(/已有 1/)
  })

  test('respects skill-level rules (blocked skill not linked)', async () => {
    makeSkill('blocked-skill')
    writeConfig({
      tools: { claudecode: toolDir },
      skillsDir: [skillsDir],
      excludeProjects: [],
      rules: { 'blocked-skill': { exclude: ['claudecode'] } },
      groupRules: {},
      toolRules: {},
      deletedSkills: [],
    })

    jest.resetModules()
    app = require('../app')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(res.body.output).toMatch(/屏蔽跳过 1/)
    expect(() => fs.lstatSync(path.join(toolDir, 'blocked-skill'))).toThrow()
  })

  test('respects toolRules.blockAll', async () => {
    makeSkill('any-skill')
    writeConfig({
      tools: { claudecode: toolDir },
      skillsDir: [skillsDir],
      excludeProjects: [],
      rules: {},
      groupRules: {},
      toolRules: { claudecode: { blockAll: true } },
      deletedSkills: [],
    })

    jest.resetModules()
    app = require('../app')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(res.body.output).toMatch(/屏蔽跳过 1/)
    expect(() => fs.lstatSync(path.join(toolDir, 'any-skill'))).toThrow()
  })

  test('warns on name conflict and skips duplicate', async () => {
    const secondSkillsDir = path.join(tmpDir, 'skills2')
    fs.mkdirSync(secondSkillsDir, { recursive: true })
    makeSkill('dupe')
    makeSkill('dupe', secondSkillsDir)
    writeConfig({
      tools: { claudecode: toolDir },
      skillsDir: [skillsDir, secondSkillsDir],
      excludeProjects: [],
      rules: {},
      groupRules: {},
      toolRules: {},
      deletedSkills: [],
    })

    jest.resetModules()
    process.env.SKILLS_DIR = `${skillsDir},${secondSkillsDir}`
    app = require('../app')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(res.body.output).toMatch(/名称冲突/)
    // Only one of the two dupes gets linked
    expect(fs.lstatSync(path.join(toolDir, 'dupe')).isSymbolicLink()).toBe(true)
  })

  test('warns and skips wrong-pointing symlink', async () => {
    const alphaDir = makeSkill('alpha')
    const wrongTarget = path.join(tmpDir, 'wrong-dir')
    fs.mkdirSync(wrongTarget, { recursive: true })
    makeSymlink(wrongTarget, toolDir, 'alpha')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(res.body.output).toMatch(/指向不同路径/)
    // Original wrong symlink untouched
    const link = fs.readlinkSync(path.join(toolDir, 'alpha'))
    expect(link).not.toBe(alphaDir)
  })

  test('warns when target exists as a real directory (not symlink)', async () => {
    makeSkill('alpha')
    fs.mkdirSync(path.join(toolDir, 'alpha'), { recursive: true })

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(res.body.output).toMatch(/已存在（非软链接）/)
  })

  test('returns summary counts in output', async () => {
    makeSkill('a')
    makeSkill('b')

    const res = await request(app).post('/api/sync').send({})

    expect(res.body.output).toMatch(/完成:/)
    expect(res.body.output).toMatch(/新建/)
    expect(res.body.output).toMatch(/已有/)
  })
})
