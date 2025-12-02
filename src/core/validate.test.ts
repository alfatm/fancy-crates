import assert from 'node:assert'
import { describe, test } from 'node:test'
import semver from 'semver'
import { parseTOML } from 'toml-eslint-parser'
import type { TOMLTable } from 'toml-eslint-parser/lib/ast/ast.js'
import { parseCargoDependencies, parseVersionRange } from './parse.js'
import { compareVersionDiff, computeStatus, getMinVersionFromRange, isExactVersion } from './validate.js'

function assertDefined<T>(value: T | null | undefined, msg = 'Expected value to be defined'): T {
  assert.ok(value != null, msg)
  return value
}

describe('getMinVersionFromRange', () => {
  test('extracts min version from caret range (^1.1.0)', () => {
    const range = assertDefined(parseVersionRange('1.1.0'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.1.0')
  })

  test('extracts min version from explicit caret (^2.0.0)', () => {
    const range = assertDefined(parseVersionRange('^2.0.0'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '2.0.0')
  })

  test('extracts min version from tilde range (~1.2.3)', () => {
    const range = assertDefined(parseVersionRange('~1.2.3'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.2.3')
  })

  test('extracts min version from >= range', () => {
    const range = assertDefined(parseVersionRange('>=1.0.0'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.0.0')
  })

  test('extracts min version from complex range (>=1.0.0, <2.0.0)', () => {
    const range = assertDefined(parseVersionRange('>=1.0.0, <2.0.0'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.0.0')
  })

  test('returns 0.0.0 for short version "0" (no explicit lower bound)', () => {
    // "0" becomes ^0 which is <1.0.0-0 (no explicit >=0.0.0)
    const range = assertDefined(parseVersionRange('0'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '0.0.0')
  })

  test('extracts min version from short version "0.1"', () => {
    // "0.1" becomes ^0.1 which is >=0.1.0 <0.2.0-0
    const range = assertDefined(parseVersionRange('0.1'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '0.1.0')
  })

  test('extracts min version from short version "1"', () => {
    // "1" becomes ^1 which is >=1.0.0 <2.0.0-0
    const range = assertDefined(parseVersionRange('1'))
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.0.0')
  })
})

describe('compareVersionDiff', () => {
  test('returns "latest" when versions are equal', () => {
    const current = assertDefined(semver.parse('1.2.3'))
    const target = assertDefined(semver.parse('1.2.3'))
    assert.strictEqual(compareVersionDiff(current, target), 'latest')
  })

  test('returns "latest" when current is newer', () => {
    const current = assertDefined(semver.parse('2.0.0'))
    const target = assertDefined(semver.parse('1.2.3'))
    assert.strictEqual(compareVersionDiff(current, target), 'latest')
  })

  test('returns "patch-behind" for patch difference (1.2.3 vs 1.2.4)', () => {
    const current = assertDefined(semver.parse('1.2.3'))
    const target = assertDefined(semver.parse('1.2.4'))
    assert.strictEqual(compareVersionDiff(current, target), 'patch-behind')
  })

  test('returns "minor-behind" for minor difference (1.1.0 vs 1.2.3)', () => {
    const current = assertDefined(semver.parse('1.1.0'))
    const target = assertDefined(semver.parse('1.2.3'))
    assert.strictEqual(compareVersionDiff(current, target), 'minor-behind')
  })

  test('returns "major-behind" for major difference (1.2.3 vs 2.0.0)', () => {
    const current = assertDefined(semver.parse('1.2.3'))
    const target = assertDefined(semver.parse('2.0.0'))
    assert.strictEqual(compareVersionDiff(current, target), 'major-behind')
  })

  test('returns "patch-behind" for prerelease difference (1.0.0-alpha vs 1.0.0)', () => {
    const current = assertDefined(semver.parse('1.0.0-alpha'))
    const target = assertDefined(semver.parse('1.0.0'))
    assert.strictEqual(compareVersionDiff(current, target), 'patch-behind')
  })
})

describe('computeStatus', () => {
  test('returns "latest" when specified version equals latest', () => {
    const range = assertDefined(parseVersionRange('1.2.3'))
    const latest = assertDefined(semver.parse('1.2.3'))
    assert.strictEqual(computeStatus(range, latest, latest), 'latest')
  })

  test('returns "latest" for 1.1.0 when latestStable 1.2.3 satisfies range ^1.1.0', () => {
    // "1.1.0" becomes ^1.1.0 which means >=1.1.0 <2.0.0, and 1.2.3 is in that range
    const range = assertDefined(parseVersionRange('1.1.0'))
    const latest = assertDefined(semver.parse('1.2.3'))
    assert.strictEqual(computeStatus(range, latest, latest), 'latest')
  })

  test('returns "latest" for 1.2.0 when latestStable 1.2.3 satisfies range ^1.2.0', () => {
    // "1.2.0" becomes ^1.2.0 which means >=1.2.0 <2.0.0, and 1.2.3 is in that range
    const range = assertDefined(parseVersionRange('1.2.0'))
    const latest = assertDefined(semver.parse('1.2.3'))
    assert.strictEqual(computeStatus(range, latest, latest), 'latest')
  })

  test('returns "major-behind" for 0.9.0 vs latest 1.0.0', () => {
    const range = assertDefined(parseVersionRange('0.9.0'))
    const latest = assertDefined(semver.parse('1.0.0'))
    assert.strictEqual(computeStatus(range, latest, latest), 'major-behind')
  })

  test('returns "error" when latest is undefined', () => {
    const range = assertDefined(parseVersionRange('1.0.0'))
    assert.strictEqual(computeStatus(range, undefined, undefined), 'error')
  })

  test('compares against latestStable when available', () => {
    // "1.0.0" becomes ^1.0.0 which means >=1.0.0 <2.0.0
    // latestStable 1.2.0 is in that range, so it's "latest"
    const range = assertDefined(parseVersionRange('1.0.0'))
    const latestStable = assertDefined(semver.parse('1.2.0'))
    const latest = assertDefined(semver.parse('2.0.0-beta')) // prerelease is latest but not stable
    // latestStable (1.2.0) satisfies the range, so status is "latest"
    assert.strictEqual(computeStatus(range, latestStable, latest), 'latest')
  })

  test('returns "minor-behind" when latestStable does not satisfy range', () => {
    // Use exact version requirement with = to ensure it doesn't match newer versions
    const range = assertDefined(parseVersionRange('=1.0.0'))
    const latestStable = assertDefined(semver.parse('1.2.0'))
    const latest = assertDefined(semver.parse('2.0.0-beta'))
    // latestStable (1.2.0) does not satisfy =1.0.0, so compare versions
    assert.strictEqual(computeStatus(range, latestStable, latest), 'minor-behind')
  })

  // Tests for short version formats (ranges)
  test('returns "latest" for short version "0" when latestStable is 0.5.0', () => {
    // "0" means ^0 which expands to >=0.0.0 <1.0.0
    const range = assertDefined(parseVersionRange('0'))
    const latestStable = assertDefined(semver.parse('0.5.0'))
    assert.strictEqual(computeStatus(range, latestStable, latestStable), 'latest')
  })

  test('returns "latest" for short version "1" when latestStable is 1.9.0', () => {
    // "1" means ^1 which expands to >=1.0.0 <2.0.0
    const range = assertDefined(parseVersionRange('1'))
    const latestStable = assertDefined(semver.parse('1.9.0'))
    assert.strictEqual(computeStatus(range, latestStable, latestStable), 'latest')
  })

  test('returns "latest" for short version "1.0" when latestStable is 1.0.5', () => {
    // "1.0" means ^1.0 which expands to >=1.0.0 <2.0.0
    const range = assertDefined(parseVersionRange('1.0'))
    const latestStable = assertDefined(semver.parse('1.0.5'))
    assert.strictEqual(computeStatus(range, latestStable, latestStable), 'latest')
  })

  test('returns "major-behind" for short version "0" when latestStable is 1.0.0', () => {
    // "0" means >=0.0.0 <1.0.0, but latest is 1.0.0 which is outside the range
    const range = assertDefined(parseVersionRange('0'))
    const latestStable = assertDefined(semver.parse('1.0.0'))
    assert.strictEqual(computeStatus(range, latestStable, latestStable), 'major-behind')
  })

  test('returns "major-behind" for short version "1" when latestStable is 2.0.0', () => {
    // "1" means >=1.0.0 <2.0.0, but latest is 2.0.0 which is outside the range
    const range = assertDefined(parseVersionRange('1'))
    const latestStable = assertDefined(semver.parse('2.0.0'))
    assert.strictEqual(computeStatus(range, latestStable, latestStable), 'major-behind')
  })

  test('returns "latest" for "0.1" when latestStable is 0.1.5', () => {
    // "0.1" means ^0.1 which expands to >=0.1.0 <0.2.0
    const range = assertDefined(parseVersionRange('0.1'))
    const latestStable = assertDefined(semver.parse('0.1.5'))
    assert.strictEqual(computeStatus(range, latestStable, latestStable), 'latest')
  })

  test('returns "minor-behind" for "0.1" when latestStable is 0.2.0', () => {
    // "0.1" means >=0.1.0 <0.2.0, but latest is 0.2.0 which is outside the range
    const range = assertDefined(parseVersionRange('0.1'))
    const latestStable = assertDefined(semver.parse('0.2.0'))
    assert.strictEqual(computeStatus(range, latestStable, latestStable), 'minor-behind')
  })
})

describe('isExactVersion', () => {
  test('returns true for full version "1.2.3"', () => {
    assert.strictEqual(isExactVersion('1.2.3'), true)
  })

  test('returns true for full version "0.1.0"', () => {
    assert.strictEqual(isExactVersion('0.1.0'), true)
  })

  test('returns true for full version with prerelease "1.2.3-alpha"', () => {
    assert.strictEqual(isExactVersion('1.2.3-alpha'), true)
  })

  test('returns true for full version with build metadata "1.2.3+build"', () => {
    assert.strictEqual(isExactVersion('1.2.3+build'), true)
  })

  test('returns false for short version "1"', () => {
    assert.strictEqual(isExactVersion('1'), false)
  })

  test('returns false for short version "1.2"', () => {
    assert.strictEqual(isExactVersion('1.2'), false)
  })

  test('returns false for caret version "^1.2.3"', () => {
    assert.strictEqual(isExactVersion('^1.2.3'), false)
  })

  test('returns false for tilde version "~1.2.3"', () => {
    assert.strictEqual(isExactVersion('~1.2.3'), false)
  })

  test('returns false for equality version "=1.2.3"', () => {
    assert.strictEqual(isExactVersion('=1.2.3'), false)
  })

  test('returns false for range ">1.0.0"', () => {
    assert.strictEqual(isExactVersion('>1.0.0'), false)
  })

  test('returns false for complex requirement "1.2.3, <2.0.0"', () => {
    assert.strictEqual(isExactVersion('1.2.3, <2.0.0'), false)
  })
})

describe('computeStatus with exact versions (versionRaw)', () => {
  test('returns "patch-behind" for exact "1.2.3" when latest is "1.2.4"', () => {
    const range = assertDefined(parseVersionRange('1.2.3'))
    const latest = assertDefined(semver.parse('1.2.4'))
    // Without versionRaw, 1.2.4 satisfies ^1.2.3 so it would be "latest"
    // But with exact versionRaw "1.2.3", we compare directly
    assert.strictEqual(computeStatus(range, latest, latest, '1.2.3'), 'patch-behind')
  })

  test('returns "minor-behind" for exact "1.2.3" when latest is "1.3.0"', () => {
    const range = assertDefined(parseVersionRange('1.2.3'))
    const latest = assertDefined(semver.parse('1.3.0'))
    assert.strictEqual(computeStatus(range, latest, latest, '1.2.3'), 'minor-behind')
  })

  test('returns "major-behind" for exact "1.2.3" when latest is "2.0.0"', () => {
    const range = assertDefined(parseVersionRange('1.2.3'))
    const latest = assertDefined(semver.parse('2.0.0'))
    assert.strictEqual(computeStatus(range, latest, latest, '1.2.3'), 'major-behind')
  })

  test('returns "latest" for exact "1.2.3" when latest is "1.2.3"', () => {
    const range = assertDefined(parseVersionRange('1.2.3'))
    const latest = assertDefined(semver.parse('1.2.3'))
    assert.strictEqual(computeStatus(range, latest, latest, '1.2.3'), 'latest')
  })

  test('returns "latest" for short "1.2" when latest is "1.2.5" (range behavior)', () => {
    // Short version should still use range behavior
    const range = assertDefined(parseVersionRange('1.2'))
    const latest = assertDefined(semver.parse('1.2.5'))
    assert.strictEqual(computeStatus(range, latest, latest, '1.2'), 'latest')
  })

  test('returns "latest" for short "1" when latest is "1.9.0" (range behavior)', () => {
    // Short version should still use range behavior
    const range = assertDefined(parseVersionRange('1'))
    const latest = assertDefined(semver.parse('1.9.0'))
    assert.strictEqual(computeStatus(range, latest, latest, '1'), 'latest')
  })
})

describe('semver range.test() for version matching', () => {
  test('Cargo caret ranges work correctly', () => {
    const versions = ['0.0.1', '0.1.0', '1.0.0', '1.2.3', '2.0.0'].map((v) => assertDefined(semver.parse(v)))

    // Cargo default: ^version (compatible versions)
    const range1 = assertDefined(parseVersionRange('1.2.3')) // ^1.2.3
    const range2 = assertDefined(parseVersionRange('0.0.1')) // ^0.0.1 (only 0.0.1)
    const range3 = assertDefined(parseVersionRange('0.1.0')) // ^0.1.0 (0.1.x)

    const satisfies1 = versions.filter((v) => range1.test(v))
    const satisfies2 = versions.filter((v) => range2.test(v))
    const satisfies3 = versions.filter((v) => range3.test(v))

    assert.deepStrictEqual(
      satisfies1.map((v) => v.version),
      ['1.2.3'],
    )
    assert.deepStrictEqual(
      satisfies2.map((v) => v.version),
      ['0.0.1'],
    )
    assert.deepStrictEqual(
      satisfies3.map((v) => v.version),
      ['0.1.0'],
    )
  })
})

function parseDependencies(tomlContent: string) {
  const toml = parseTOML(tomlContent)
  const tables = toml.body[0].body.filter((v): v is TOMLTable => v.type === 'TOMLTable')
  return parseCargoDependencies(tables)
}

describe('parseCargoDependencies with path dependencies', () => {
  test('parses path dependency', () => {
    const deps = parseDependencies(`
[dependencies]
local_crate = { path = "../local_crate" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.name, 'local_crate')
    assert.strictEqual(dep.source.type, 'path')
    if (dep.source.type === 'path') {
      assert.strictEqual(dep.source.path, '../local_crate')
    }
    assert.strictEqual(dep.version, undefined)
  })

  test('parses path dependency with version', () => {
    const deps = parseDependencies(`
[dependencies]
local_crate = { path = "../local_crate", version = "1.0.0" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.name, 'local_crate')
    assert.strictEqual(dep.source.type, 'path')
    assert.notStrictEqual(dep.version, undefined)
    assert.strictEqual(dep.versionRaw, '1.0.0')
  })

  test('parses path dependency with package rename', () => {
    const deps = parseDependencies(`
[dependencies]
my_alias = { path = "../other_crate", package = "other_crate" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.name, 'other_crate')
    assert.strictEqual(dep.source.type, 'path')
  })
})

describe('parseCargoDependencies with git dependencies', () => {
  test('parses git dependency', () => {
    const deps = parseDependencies(`
[dependencies]
regex = { git = "https://github.com/rust-lang/regex.git" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.name, 'regex')
    assert.strictEqual(dep.source.type, 'git')
    if (dep.source.type === 'git') {
      assert.strictEqual(dep.source.git, 'https://github.com/rust-lang/regex.git')
      assert.strictEqual(dep.source.branch, undefined)
      assert.strictEqual(dep.source.tag, undefined)
      assert.strictEqual(dep.source.rev, undefined)
    }
  })

  test('parses git dependency with branch', () => {
    const deps = parseDependencies(`
[dependencies]
regex = { git = "https://github.com/rust-lang/regex.git", branch = "next" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.source.type, 'git')
    if (dep.source.type === 'git') {
      assert.strictEqual(dep.source.branch, 'next')
    }
  })

  test('parses git dependency with tag', () => {
    const deps = parseDependencies(`
[dependencies]
regex = { git = "https://github.com/rust-lang/regex.git", tag = "1.10.3" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.source.type, 'git')
    if (dep.source.type === 'git') {
      assert.strictEqual(dep.source.tag, '1.10.3')
    }
  })

  test('parses git dependency with rev', () => {
    const deps = parseDependencies(`
[dependencies]
regex = { git = "https://github.com/rust-lang/regex.git", rev = "0c0990399270277832fbb5b91a1fa118e6f63dba" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.source.type, 'git')
    if (dep.source.type === 'git') {
      assert.strictEqual(dep.source.rev, '0c0990399270277832fbb5b91a1fa118e6f63dba')
    }
  })

  test('parses git dependency with version', () => {
    const deps = parseDependencies(`
[dependencies]
regex = { git = "https://github.com/rust-lang/regex.git", version = "1.10" }
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.source.type, 'git')
    assert.notStrictEqual(dep.version, undefined)
    assert.strictEqual(dep.versionRaw, '1.10')
  })
})

describe('parseCargoDependencies with mixed dependencies', () => {
  test('parses registry, path, and git dependencies together', () => {
    const deps = parseDependencies(`
[dependencies]
serde = "1.0"
local_lib = { path = "../lib" }
git_lib = { git = "https://github.com/user/repo" }
another = { version = "2.0", registry = "my-registry" }
`)
    assert.strictEqual(deps.length, 4)

    const serde = assertDefined(deps.find((d) => d.name === 'serde'))
    assert.strictEqual(serde.source.type, 'registry')
    assert.strictEqual(serde.versionRaw, '1.0')

    const local = assertDefined(deps.find((d) => d.name === 'local_lib'))
    assert.strictEqual(local.source.type, 'path')

    const git = assertDefined(deps.find((d) => d.name === 'git_lib'))
    assert.strictEqual(git.source.type, 'git')

    const another = assertDefined(deps.find((d) => d.name === 'another'))
    assert.strictEqual(another.source.type, 'registry')
    if (another.source.type === 'registry') {
      assert.strictEqual(another.source.registry, 'my-registry')
    }
  })

  test('parses table-style path dependency', () => {
    const deps = parseDependencies(`
[dependencies.my_local]
path = "../my_local"
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.name, 'my_local')
    assert.strictEqual(dep.source.type, 'path')
  })

  test('parses table-style git dependency with all options', () => {
    const deps = parseDependencies(`
[dependencies.my_git]
git = "https://github.com/user/repo"
branch = "develop"
version = "0.5"
`)
    assert.strictEqual(deps.length, 1)
    const dep = assertDefined(deps[0])
    assert.strictEqual(dep.name, 'my_git')
    assert.strictEqual(dep.source.type, 'git')
    if (dep.source.type === 'git') {
      assert.strictEqual(dep.source.branch, 'develop')
    }
    assert.strictEqual(dep.versionRaw, '0.5')
  })
})
