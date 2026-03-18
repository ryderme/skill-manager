'use strict'

// RED phase: these tests will fail because lib/skillLogic.js does not exist yet.

const { isAllowed } = require('../lib/skillLogic')

// Helper to build a minimal context object accepted by isAllowed.
// isAllowed(skillName, tool, group, { toolRules, groupRules, rules })
function ctx(overrides = {}) {
  return {
    toolRules: {},
    groupRules: {},
    rules: {},
    ...overrides,
  }
}

describe('isAllowed — tool-level rules (priority 1)', () => {
  test('allows any skill when no rules are set', () => {
    expect(isAllowed('my-skill', 'claudecode', 'my-group', ctx())).toBe(true)
  })

  test('blocks skill when tool has blockAll=true and skill is not in allow list', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true } },
    })
    expect(isAllowed('some-skill', 'codex', 'any-group', context)).toBe(false)
  })

  test('allows skill when tool has blockAll=true but skill is explicitly in allow list', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true, allow: ['special-skill'] } },
    })
    expect(isAllowed('special-skill', 'codex', 'any-group', context)).toBe(true)
  })

  test('allows skill when tool has blockAll=true and skill group is in allowGroups', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true, allowGroups: ['trusted-group'] } },
    })
    expect(isAllowed('any-skill', 'codex', 'trusted-group', context)).toBe(true)
  })

  test('blocks skill when tool has blockAll=true and group is NOT in allowGroups', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true, allowGroups: ['trusted-group'] } },
    })
    expect(isAllowed('any-skill', 'codex', 'untrusted-group', context)).toBe(false)
  })

  test('tool-level allow overrides blockAll even when group is not in allowGroups', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true, allowGroups: ['trusted-group'], allow: ['vip-skill'] } },
    })
    expect(isAllowed('vip-skill', 'codex', 'untrusted-group', context)).toBe(true)
  })

  test('blockAll=false is treated as no blockAll rule', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: false } },
    })
    expect(isAllowed('any-skill', 'codex', 'any-group', context)).toBe(true)
  })
})

describe('isAllowed — group-level rules (priority 2)', () => {
  test('blocks skill when group rule has "only" and tool is not included', () => {
    const context = ctx({
      groupRules: { baijiahao: { only: ['openclaw'] } },
    })
    expect(isAllowed('skill-x', 'claudecode', 'baijiahao', context)).toBe(false)
  })

  test('allows skill when group rule has "only" and tool IS included', () => {
    const context = ctx({
      groupRules: { baijiahao: { only: ['openclaw'] } },
    })
    expect(isAllowed('skill-x', 'openclaw', 'baijiahao', context)).toBe(true)
  })

  test('blocks skill when group rule has "exclude" containing the tool', () => {
    const context = ctx({
      groupRules: { somegroup: { exclude: ['claudecode'] } },
    })
    expect(isAllowed('skill-x', 'claudecode', 'somegroup', context)).toBe(false)
  })

  test('allows skill when group rule has "exclude" but tool is NOT in it', () => {
    const context = ctx({
      groupRules: { somegroup: { exclude: ['claudecode'] } },
    })
    expect(isAllowed('skill-x', 'openclaw', 'somegroup', context)).toBe(true)
  })

  test('group rules are skipped when group is null/undefined', () => {
    const context = ctx({
      groupRules: { somegroup: { only: ['openclaw'] } },
    })
    expect(isAllowed('skill-x', 'claudecode', null, context)).toBe(true)
  })

  test('group rules are skipped when group is empty string', () => {
    const context = ctx({
      groupRules: { somegroup: { only: ['openclaw'] } },
    })
    expect(isAllowed('skill-x', 'claudecode', '', context)).toBe(true)
  })
})

describe('isAllowed — skill-level rules (priority 3)', () => {
  test('blocks skill when skill rule has "exclude" containing the tool', () => {
    const context = ctx({
      rules: { 'my-skill': { exclude: ['codex'] } },
    })
    expect(isAllowed('my-skill', 'codex', 'any-group', context)).toBe(false)
  })

  test('allows skill when skill rule has "exclude" but tool is NOT in it', () => {
    const context = ctx({
      rules: { 'my-skill': { exclude: ['codex'] } },
    })
    expect(isAllowed('my-skill', 'claudecode', 'any-group', context)).toBe(true)
  })

  test('allows skill when skill rule has "only" containing the tool', () => {
    const context = ctx({
      rules: { 'my-skill': { only: ['claudecode'] } },
    })
    expect(isAllowed('my-skill', 'claudecode', 'any-group', context)).toBe(true)
  })

  test('blocks skill when skill rule has "only" but tool is NOT included', () => {
    const context = ctx({
      rules: { 'my-skill': { only: ['claudecode'] } },
    })
    expect(isAllowed('my-skill', 'codex', 'any-group', context)).toBe(false)
  })

  test('allows skill with no matching rule entry', () => {
    const context = ctx({
      rules: { 'other-skill': { exclude: ['codex'] } },
    })
    expect(isAllowed('my-skill', 'codex', 'any-group', context)).toBe(true)
  })
})

describe('isAllowed — priority ordering', () => {
  test('tool blockAll overrides a permissive group rule', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true } },
      groupRules: { mygroup: { only: ['codex'] } },
    })
    // group says "only codex" but tool blocks everything
    expect(isAllowed('any-skill', 'codex', 'mygroup', context)).toBe(false)
  })

  test('tool blockAll+allow overrides a blocking group rule', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true, allow: ['vip-skill'] } },
      groupRules: { mygroup: { exclude: ['codex'] } },
    })
    // vip-skill is in allow list, so it wins even though group blocks codex
    expect(isAllowed('vip-skill', 'codex', 'mygroup', context)).toBe(true)
  })

  test('group rule blocks before skill rule is evaluated', () => {
    const context = ctx({
      groupRules: { mygroup: { only: ['openclaw'] } },
      rules: { 'special-skill': { only: ['claudecode', 'codex'] } },
    })
    // skill says it is only for claudecode/codex but group says only openclaw
    expect(isAllowed('special-skill', 'claudecode', 'mygroup', context)).toBe(false)
  })
})

describe('isAllowed — edge cases', () => {
  test('handles undefined toolRules gracefully', () => {
    // context with no toolRules key at all
    expect(isAllowed('skill', 'tool', 'group', { toolRules: {}, groupRules: {}, rules: {} })).toBe(true)
  })

  test('empty allow list on blockAll tool still blocks', () => {
    const context = ctx({
      toolRules: { codex: { blockAll: true, allow: [] } },
    })
    expect(isAllowed('any-skill', 'codex', 'any-group', context)).toBe(false)
  })

  test('empty only array on skill rule blocks all tools', () => {
    const context = ctx({
      rules: { 'locked-skill': { only: [] } },
    })
    expect(isAllowed('locked-skill', 'claudecode', 'any-group', context)).toBe(false)
  })

  test('skill rule entry with neither only nor exclude allows all tools (defensive default)', () => {
    // A rule object with no "only" or "exclude" keys still allows the skill.
    const context = ctx({
      rules: { 'my-skill': {} },
    })
    expect(isAllowed('my-skill', 'claudecode', 'any-group', context)).toBe(true)
  })
})
