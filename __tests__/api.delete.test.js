'use strict'

// RED phase: integration tests for DELETE /api/skills/:name and DELETE /api/groups/:group
// Uses supertest against the express app.
// The app module must be extracted so we can inject a test tools.json and
// control the filesystem without side effects.

const path = require('path')
const os = require('os')
const fs = require('fs')
const request = require('supertest')

// We create a temp directory for each test that acts as the skill universe.
// The app is loaded fresh for each test suite by setting env vars before require().

let tmpDir
let skillsDir
let toolDir
let configPath

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

describe('DELETE /api/skills/:name — soft delete', () => {
  let app

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-test-'))
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

    // Reset module registry so the server loads fresh config
    jest.resetModules()
    process.env.SKILLS_DIR = skillsDir
    process.env.CLAUDECODE_SKILLS = toolDir
    // Point server to our temp config
    process.env._TEST_CONFIG_PATH = configPath

    app = require('../app')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.SKILLS_DIR
    delete process.env.CLAUDECODE_SKILLS
    delete process.env._TEST_CONFIG_PATH
  })

  test('returns 404 when skill does not exist', async () => {
    const res = await request(app)
      .delete('/api/skills/nonexistent')
      .send({})
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  test('soft deletes: adds skill to deletedSkills in config', async () => {
    makeSkill('cool-skill')

    const res = await request(app)
      .delete('/api/skills/cool-skill')
      .send({ hardDelete: false })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.softDeleted).toBe(true)
    expect(res.body.hardDeleted).toBe(false)

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.deletedSkills).toContain('cool-skill')
  })

  test('soft delete removes existing symlink from tool directory', async () => {
    const skillDir = makeSkill('linked-skill')
    const link = makeSymlink(skillDir, toolDir, 'linked-skill')

    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)

    const res = await request(app)
      .delete('/api/skills/linked-skill')
      .send({ hardDelete: false })

    expect(res.status).toBe(200)
    expect(res.body.removed).toContain('claudecode')

    // Symlink should be gone
    expect(() => fs.lstatSync(link)).toThrow()
  })

  test('soft delete does NOT remove the skill directory from disk', async () => {
    const skillDir = makeSkill('preserved-skill')

    await request(app)
      .delete('/api/skills/preserved-skill')
      .send({ hardDelete: false })

    // Directory must still exist
    expect(fs.existsSync(skillDir)).toBe(true)
  })

  test('hard delete removes skill directory from disk', async () => {
    const skillDir = makeSkill('doomed-skill')

    const res = await request(app)
      .delete('/api/skills/doomed-skill')
      .send({ hardDelete: true })

    expect(res.status).toBe(200)
    expect(res.body.hardDeleted).toBe(true)
    expect(fs.existsSync(skillDir)).toBe(false)
  })

  test('hard delete also removes symlinks and adds to deletedSkills', async () => {
    const skillDir = makeSkill('full-delete-skill')
    const link = makeSymlink(skillDir, toolDir, 'full-delete-skill')

    const res = await request(app)
      .delete('/api/skills/full-delete-skill')
      .send({ hardDelete: true })

    expect(res.status).toBe(200)
    expect(res.body.softDeleted).toBe(true)
    expect(res.body.hardDeleted).toBe(true)
    expect(() => fs.lstatSync(link)).toThrow()
    expect(fs.existsSync(skillDir)).toBe(false)

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.deletedSkills).toContain('full-delete-skill')
  })

  test('hard-deleted skill returns 404 on subsequent delete attempt', async () => {
    // After a hard delete the directory is gone, so a second call cannot find it.
    makeSkill('once-skill')

    await request(app)
      .delete('/api/skills/once-skill')
      .send({ hardDelete: true })

    // Reload app to pick up updated deletedSkills
    jest.resetModules()
    const app2 = require('../app')
    const res = await request(app2)
      .delete('/api/skills/once-skill')
      .send({ hardDelete: false })
    expect(res.status).toBe(404)
  })

  test('soft delete is idempotent — second soft delete still returns ok', async () => {
    // doDeleteSkill intentionally bypasses the DELETED_SKILLS filter so a
    // second call (on a directory that still exists) returns ok, not 404.
    makeSkill('twice-skill')

    const first = await request(app)
      .delete('/api/skills/twice-skill')
      .send({ hardDelete: false })
    expect(first.status).toBe(200)

    // The directory is still on disk; the second call can still find it.
    jest.resetModules()
    const app2 = require('../app')
    const second = await request(app2)
      .delete('/api/skills/twice-skill')
      .send({ hardDelete: false })
    expect(second.status).toBe(200)
    expect(second.body.softDeleted).toBe(true)
  })
})

describe('DELETE /api/groups/:group', () => {
  let app

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-grp-test-'))
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

  function makeGroupSkill(groupName, skillName) {
    const groupDir = path.join(skillsDir, groupName)
    fs.mkdirSync(groupDir, { recursive: true })
    return makeSkill(skillName, groupDir)
  }

  test('returns 404 when group has no skills', async () => {
    const res = await request(app)
      .delete('/api/groups/nonexistent-group')
      .send({})
    expect(res.status).toBe(404)
    expect(res.body).toHaveProperty('error')
  })

  test('soft deletes all skills in the group', async () => {
    makeGroupSkill('team', 'skill-one')
    makeGroupSkill('team', 'skill-two')

    const res = await request(app)
      .delete('/api/groups/team')
      .send({ hardDelete: false })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.count).toBe(2)
    expect(res.body.hardDeleted).toBe(false)

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.deletedSkills).toContain('skill-one')
    expect(saved.deletedSkills).toContain('skill-two')
  })

  test('does not delete skills in other groups', async () => {
    makeGroupSkill('team-a', 'skill-a')
    makeGroupSkill('team-b', 'skill-b')

    const res = await request(app)
      .delete('/api/groups/team-a')
      .send({ hardDelete: false })

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.deletedSkills).toContain('skill-a')
    expect(saved.deletedSkills).not.toContain('skill-b')
  })

  test('hard delete removes all group skill directories', async () => {
    const dir1 = makeGroupSkill('doomed-group', 'doomed-skill-1')
    const dir2 = makeGroupSkill('doomed-group', 'doomed-skill-2')

    const res = await request(app)
      .delete('/api/groups/doomed-group')
      .send({ hardDelete: true })

    expect(res.status).toBe(200)
    expect(res.body.hardDeleted).toBe(true)
    expect(fs.existsSync(dir1)).toBe(false)
    expect(fs.existsSync(dir2)).toBe(false)
  })

  test('returns results array with one entry per skill', async () => {
    makeGroupSkill('mygroup', 'alpha')
    makeGroupSkill('mygroup', 'beta')
    makeGroupSkill('mygroup', 'gamma')

    const res = await request(app)
      .delete('/api/groups/mygroup')
      .send({ hardDelete: false })

    expect(res.body.results).toHaveLength(3)
    const names = res.body.results.map(r => r.name)
    expect(names).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']))
  })

  test('group delete removes symlinks for all skills in the group', async () => {
    const dir1 = makeGroupSkill('linked-group', 'linked-one')
    const dir2 = makeGroupSkill('linked-group', 'linked-two')
    const link1 = makeSymlink(dir1, toolDir, 'linked-one')
    const link2 = makeSymlink(dir2, toolDir, 'linked-two')

    const res = await request(app)
      .delete('/api/groups/linked-group')
      .send({ hardDelete: false })

    expect(res.status).toBe(200)
    expect(() => fs.lstatSync(link1)).toThrow()
    expect(() => fs.lstatSync(link2)).toThrow()
  })
})
