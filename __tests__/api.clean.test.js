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

function makeSymlink(target, toolTarget, name) {
  const link = path.join(toolTarget, name)
  try { fs.unlinkSync(link) } catch {}
  fs.symlinkSync(target, link)
  return link
}

describe('POST /api/clean', () => {
  let app

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-clean-test-'))
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

  test('removes dangling symlinks (target no longer exists)', async () => {
    const ghostPath = path.join(tmpDir, 'ghost-skill')
    makeSymlink(ghostPath, toolDir, 'ghost')

    const res = await request(app).post('/api/clean').send({})

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(() => fs.lstatSync(path.join(toolDir, 'ghost'))).toThrow()
    expect(res.body.output).toMatch(/删除失效链接/)
  })

  test('does NOT remove valid symlinks', async () => {
    const alphaDir = makeSkill('alpha')
    makeSymlink(alphaDir, toolDir, 'alpha')

    const res = await request(app).post('/api/clean').send({})

    expect(res.status).toBe(200)
    expect(fs.lstatSync(path.join(toolDir, 'alpha')).isSymbolicLink()).toBe(true)
    expect(res.body.output).toMatch(/删除 0 个/)
  })

  test('does NOT remove real directories in tool dir', async () => {
    fs.mkdirSync(path.join(toolDir, 'real-dir'), { recursive: true })

    const res = await request(app).post('/api/clean').send({})

    expect(res.status).toBe(200)
    expect(fs.statSync(path.join(toolDir, 'real-dir')).isDirectory()).toBe(true)
  })

  test('handles empty tool directory gracefully', async () => {
    const res = await request(app).post('/api/clean').send({})

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.output).toMatch(/删除 0 个/)
  })

  test('handles non-existent tool directory gracefully', async () => {
    writeConfig({
      tools: { claudecode: path.join(tmpDir, 'nonexistent-tool-dir') },
      skillsDir: [skillsDir],
      excludeProjects: [],
      rules: {},
      groupRules: {},
      toolRules: {},
      deletedSkills: [],
    })
    jest.resetModules()
    process.env.CLAUDECODE_SKILLS = path.join(tmpDir, 'nonexistent-tool-dir')
    app = require('../app')

    const res = await request(app).post('/api/clean').send({})

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  test('returns cleaned count in output', async () => {
    const ghost1 = path.join(tmpDir, 'ghost1')
    const ghost2 = path.join(tmpDir, 'ghost2')
    makeSymlink(ghost1, toolDir, 'ghost1')
    makeSymlink(ghost2, toolDir, 'ghost2')

    const res = await request(app).post('/api/clean').send({})

    expect(res.status).toBe(200)
    expect(res.body.output).toMatch(/删除 2 个/)
  })
})
