import assert from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { loadCargoConfig, parseCargoConfig } from './cargo'
import { resolveIndexPath } from './fetch'
import { buildNewRequirement, escapeMarkdown, inlineCode } from './format'
import { hasFileDisableCheck } from './parse'

describe('parseCargoConfig', () => {
  test('reads registries and strips the sparse+ prefix', () => {
    const config = parseCargoConfig(
      { registries: { 'my-reg': { index: 'sparse+https://example.com/index/', token: 'from-config' } } },
      undefined,
      {},
    )
    assert.deepStrictEqual(config.registries, [
      { name: 'my-reg', index: 'https://example.com/index/', token: 'from-config' },
    ])
  })

  test('token priority: env > credentials > config', () => {
    const raw = { registries: { 'my-reg': { index: 'https://example.com/', token: 'config' } } }
    const credentials = { registries: { 'my-reg': { token: 'credentials' } } }
    assert.strictEqual(parseCargoConfig(raw, credentials, {}).registries[0]?.token, 'credentials')
    assert.strictEqual(
      parseCargoConfig(raw, credentials, { CARGO_REGISTRIES_MY_REG_TOKEN: 'env' }).registries[0]?.token,
      'env',
    )
  })

  test('resolves crates-io source replacement via [source]', () => {
    const config = parseCargoConfig(
      { source: { 'crates-io': { 'replace-with': 'mirror' }, mirror: { registry: 'sparse+https://mirror/' } } },
      undefined,
      {},
    )
    assert.deepStrictEqual(config.sourceReplacement, {
      source: 'crates-io',
      replaceWith: 'mirror',
      index: 'https://mirror/',
      token: undefined,
    })
  })

  test('resolves crates-io source replacement via [registries]', () => {
    const config = parseCargoConfig(
      { source: { 'crates-io': { 'replace-with': 'corp' } }, registries: { corp: { index: 'sparse+https://corp/' } } },
      undefined,
      {},
    )
    assert.strictEqual(config.sourceReplacement?.index, 'https://corp/')
  })
})

describe('loadCargoConfig', () => {
  let root: string
  const savedCargoHome = process.env.CARGO_HOME

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'fancy-crates-'))
    const cargoHome = path.join(root, 'cargo-home')
    await mkdir(cargoHome, { recursive: true })
    await mkdir(path.join(root, 'ws', '.cargo'), { recursive: true })
    await mkdir(path.join(root, 'ws', 'crate', '.cargo'), { recursive: true })
    await writeFile(
      path.join(cargoHome, 'config.toml'),
      '[registries.home]\nindex = "sparse+https://home/"\n[registries.shared]\nindex = "sparse+https://home-shared/"\n',
    )
    await writeFile(path.join(cargoHome, 'credentials.toml'), '[registries.home]\ntoken = "secret"\n')
    await writeFile(
      path.join(root, 'ws', '.cargo', 'config.toml'),
      '[registries.shared]\nindex = "https://ws-shared/"\n',
    )
    await writeFile(
      path.join(root, 'ws', 'crate', '.cargo', 'config.toml'),
      '[registries]\nlocal = { index = "sparse+https://local/" }\n',
    )
    process.env.CARGO_HOME = cargoHome
  })

  after(async () => {
    process.env.CARGO_HOME = savedCargoHome
    await rm(root, { recursive: true, force: true })
  })

  test('merges configs hierarchically, closer files win', async () => {
    const config = await loadCargoConfig(path.join(root, 'ws', 'crate'))
    const byName = Object.fromEntries(config.registries.map((r) => [r.name, r]))
    assert.deepStrictEqual(byName.home, { name: 'home', index: 'https://home/', token: 'secret' })
    assert.strictEqual(byName.shared?.index, 'https://ws-shared/')
    assert.strictEqual(byName.local?.index, 'https://local/')
  })
})

describe('resolveIndexPath', () => {
  test('lowercases crate names', () => {
    assert.strictEqual(resolveIndexPath('Inflector'), 'in/fl/inflector')
    assert.strictEqual(resolveIndexPath('A'), '1/a')
    assert.strictEqual(resolveIndexPath('Abc'), '3/a/abc')
  })
})

describe('markdown escaping', () => {
  test('escapeMarkdown neutralizes links', () => {
    const escaped = escapeMarkdown('[x](command:evil)')
    assert.strictEqual(escaped, '\\[x\\]\\(command:evil\\)')
  })

  test('inlineCode uses a fence longer than any backtick run', () => {
    assert.strictEqual(inlineCode('abc'), '`abc`')
    assert.strictEqual(inlineCode('a`b'), '``a`b``')
    assert.strictEqual(inlineCode('`x`'), '`` `x` ``')
  })
})

describe('buildNewRequirement', () => {
  test('keeps a single leading operator', () => {
    assert.strictEqual(buildNewRequirement('^1.2', '2.0.0'), '^2.0.0')
    assert.strictEqual(buildNewRequirement('~1.2.3', '2.0.0'), '~2.0.0')
    assert.strictEqual(buildNewRequirement('=1.0.0', '2.0.0'), '=2.0.0')
    assert.strictEqual(buildNewRequirement('1.2', '2.0.0'), '2.0.0')
  })

  test('replaces compound requirements with the plain version', () => {
    assert.strictEqual(buildNewRequirement('>=1, <2', '2.0.0'), '2.0.0')
    assert.strictEqual(buildNewRequirement('^1, <1.5', '2.0.0'), '2.0.0')
  })
})

describe('hasFileDisableCheck', () => {
  test('detects the comment in the header', () => {
    assert.ok(hasFileDisableCheck('# my crate\n\n#! crates: disable-check\n[package]\n'))
  })

  test('ignores the comment after the header', () => {
    assert.ok(!hasFileDisableCheck('[package]\nname = "x"\n#! crates: disable-check\n'))
  })
})
