'use strict'

const path = require('path')
const os = require('os')
const fs = require('fs')
const request = require('supertest')

let tmpDir, skillsDir, toolDir, configPath

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function makeSkill(name) {
  const dir = path.join(skillsDir, name)
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

function baseConfig() {
  return {
    tools: { claudecode: toolDir },
    skillsDir: [skillsDir],
    excludeProjects: [],
    rules: {},
    groupRules: {},
    toolRules: {},
    deletedSkills: [],
  }
}

describe('manual unlinks', () => {
  let app

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-manual-test-'))
    skillsDir = path.join(tmpDir, 'skills')
    toolDir = path.join(tmpDir, 'tool-claudecode')
    fs.mkdirSync(skillsDir, { recursive: true })
    fs.mkdirSync(toolDir, { recursive: true })

    configPath = path.join(tmpDir, 'tools.json')
    writeConfig(baseConfig())

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

  test('DELETE link records skill+tool in manualUnlinks', async () => {
    const skillDir = makeSkill('my-skill')
    makeSymlink(skillDir, toolDir, 'my-skill')

    const res = await request(app)
      .delete('/api/skills/my-skill/link')
      .send({ tool: 'claudecode' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.manualUnlinks?.['my-skill']).toContain('claudecode')
  })

  test('GET /api/skills returns status "manual" for manually unlinked skills', async () => {
    makeSkill('my-skill')
    writeConfig({ ...baseConfig(), manualUnlinks: { 'my-skill': ['claudecode'] } })
    jest.resetModules()
    app = require('../app')

    const res = await request(app).get('/api/skills')

    expect(res.status).toBe(200)
    const skill = res.body.skills.find(s => s.name === 'my-skill')
    expect(skill.status.claudecode).toBe('manual')
  })

  test('POST link removes skill+tool from manualUnlinks', async () => {
    const skillDir = makeSkill('my-skill')
    writeConfig({ ...baseConfig(), manualUnlinks: { 'my-skill': ['claudecode'] } })
    jest.resetModules()
    app = require('../app')

    const res = await request(app)
      .post('/api/skills/my-skill/link')
      .send({ tool: 'claudecode' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(fs.lstatSync(path.join(toolDir, 'my-skill')).isSymbolicLink()).toBe(true)

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.manualUnlinks?.['my-skill'] ?? []).not.toContain('claudecode')
  })

  test('sync skips manually unlinked skills', async () => {
    makeSkill('my-skill')
    writeConfig({ ...baseConfig(), manualUnlinks: { 'my-skill': ['claudecode'] } })
    jest.resetModules()
    app = require('../app')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    // Symlink should NOT be created
    expect(() => fs.lstatSync(path.join(toolDir, 'my-skill'))).toThrow()
    expect(res.body.output).toMatch(/手动跳过 1/)
  })

  test('sync creates link for skill NOT in manualUnlinks', async () => {
    makeSkill('normal-skill')
    writeConfig({ ...baseConfig(), manualUnlinks: { 'other-skill': ['claudecode'] } })
    jest.resetModules()
    app = require('../app')

    const res = await request(app).post('/api/sync').send({})

    expect(res.status).toBe(200)
    expect(fs.lstatSync(path.join(toolDir, 'normal-skill')).isSymbolicLink()).toBe(true)
  })

  test('manualUnlinks key is removed from config when empty', async () => {
    const skillDir = makeSkill('my-skill')
    writeConfig({ ...baseConfig(), manualUnlinks: { 'my-skill': ['claudecode'] } })
    jest.resetModules()
    app = require('../app')

    // Re-link clears the entry; since it was the only one, key should vanish
    makeSymlink(skillDir, toolDir, 'my-skill')
    await request(app)
      .post('/api/skills/my-skill/link')
      .send({ tool: 'claudecode' })

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.manualUnlinks).toBeUndefined()
  })

  test('batch unlink records all items in manualUnlinks', async () => {
    const dirA = makeSkill('skill-a')
    const dirB = makeSkill('skill-b')
    makeSymlink(dirA, toolDir, 'skill-a')
    makeSymlink(dirB, toolDir, 'skill-b')

    const res = await request(app)
      .post('/api/batch/unlink')
      .send({ items: [{ name: 'skill-a', tool: 'claudecode' }, { name: 'skill-b', tool: 'claudecode' }] })

    expect(res.status).toBe(200)
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.manualUnlinks?.['skill-a']).toContain('claudecode')
    expect(saved.manualUnlinks?.['skill-b']).toContain('claudecode')
  })

  test('batch link removes items from manualUnlinks', async () => {
    makeSkill('skill-a')
    makeSkill('skill-b')
    writeConfig({ ...baseConfig(), manualUnlinks: { 'skill-a': ['claudecode'], 'skill-b': ['claudecode'] } })
    jest.resetModules()
    app = require('../app')

    const res = await request(app)
      .post('/api/batch/link')
      .send({ items: [{ name: 'skill-a', tool: 'claudecode' }, { name: 'skill-b', tool: 'claudecode' }] })

    expect(res.status).toBe(200)
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.manualUnlinks).toBeUndefined()
  })

  test('deleting a skill cleans up its manualUnlinks entry', async () => {
    makeSkill('doomed')
    writeConfig({ ...baseConfig(), manualUnlinks: { doomed: ['claudecode'] } })
    jest.resetModules()
    app = require('../app')

    await request(app).delete('/api/skills/doomed').send({ hardDelete: false })

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.manualUnlinks?.doomed).toBeUndefined()
  })
})
