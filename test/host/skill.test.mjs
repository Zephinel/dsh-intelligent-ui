/**
 * Host-half regression test: load the built `lib/index.js` with a fake Cordis
 * context and exercise the embedded Agent Skill registration.
 *
 *   node scripts/build.mjs host
 *   node --test test/host/skill.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'

const plugin = await import('../../lib/index.js')
const SKILL_FILE = new URL('../../skills/intelligent-ui/SKILL.md', import.meta.url)
const authored = existsSync(SKILL_FILE)

/** Mount the plugin on a stub context that immediately satisfies `skills`. */
function mount() {
  const registered = { skill: undefined }
  plugin.apply({
    tools: { register() {} },
    systemPrompt: { section() {} },
    logger: { warn() {} },
    inject(dependencies, callback) {
      // The mode controller asks for sessionProjections/commands first; treat
      // them as unavailable in this stub so the legacy always-on path stays.
      if (!normalize(dependencies).includes('skills')) return
      assert.deepEqual(normalize(dependencies), ['skills'])
      callback({ skills: { register(skill) { registered.skill = skill } } })
    },
  })
  return registered
}

const normalize = (dependencies) => [...dependencies]

test('registers the shipped Agent Skill when the skill registry is composed', { skip: authored ? false : 'skills/intelligent-ui/SKILL.md not authored yet' }, () => {
  const { skill } = mount()
  assert.ok(skill, 'skill registered')
  assert.equal(skill.name, 'intelligent-ui')
  assert.ok(typeof skill.description === 'string' && skill.description.length > 0)
  assert.ok(skill.description.length <= 500, 'catalog descriptions are capped at 500 characters')
  assert.ok(!skill.description.includes('\n'), 'description is a single logical line')
  assert.ok(typeof skill.content === 'string' && skill.content.length > 1000, 'the body carries the full instructions')
  assert.match(skill.content, /render_ui/)
  assert.match(skill.content, /references\//)
  assert.equal(skill.resourceBase.kind, 'directory')
  assert.match(skill.resourceBase.path, /skills\/intelligent-ui$/)
  assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(skill.source, 'runtime')
  assert.equal(skill.metadata.origin, 'dsh-intelligent-ui')
})

test('the shipped frontmatter names the skill and routes the model', { skip: authored ? false : 'skills/intelligent-ui/SKILL.md not authored yet' }, async () => {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(SKILL_FILE, 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  assert.ok(frontmatter, 'YAML frontmatter present')
  assert.match(frontmatter[1], /^name: intelligent-ui$/m)
  assert.match(frontmatter[1], /^description: \S/m)
})

test('a context without the skill registry still mounts the tool surface', () => {
  const sections = []
  let tool
  plugin.apply({
    tools: { register(definition) { tool = definition } },
    systemPrompt: { section(section) { sections.push(section) } },
  })
  assert.equal(tool.name, 'render_ui')
  assert.equal(sections.length, 1)
})
