import assert from 'node:assert'
import { describe, test } from 'node:test'
import semver from 'semver'
import { parseVersionRange } from './parse'
import { compareVersionDiff, computeStatus, getMinVersionFromRange } from './validate'

describe('getMinVersionFromRange', () => {
  test('extracts min version from caret range (^1.1.0)', () => {
    const range = parseVersionRange('1.1.0')!
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.1.0')
  })

  test('extracts min version from explicit caret (^2.0.0)', () => {
    const range = parseVersionRange('^2.0.0')!
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '2.0.0')
  })

  test('extracts min version from tilde range (~1.2.3)', () => {
    const range = parseVersionRange('~1.2.3')!
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.2.3')
  })

  test('extracts min version from >= range', () => {
    const range = parseVersionRange('>=1.0.0')!
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.0.0')
  })

  test('extracts min version from complex range (>=1.0.0, <2.0.0)', () => {
    const range = parseVersionRange('>=1.0.0, <2.0.0')!
    const min = getMinVersionFromRange(range)
    assert.strictEqual(min?.version, '1.0.0')
  })
})

describe('compareVersionDiff', () => {
  test('returns "latest" when versions are equal', () => {
    const current = semver.parse('1.2.3')!
    const target = semver.parse('1.2.3')!
    assert.strictEqual(compareVersionDiff(current, target), 'latest')
  })

  test('returns "latest" when current is newer', () => {
    const current = semver.parse('2.0.0')!
    const target = semver.parse('1.2.3')!
    assert.strictEqual(compareVersionDiff(current, target), 'latest')
  })

  test('returns "patch-behind" for patch difference (1.2.3 vs 1.2.4)', () => {
    const current = semver.parse('1.2.3')!
    const target = semver.parse('1.2.4')!
    assert.strictEqual(compareVersionDiff(current, target), 'patch-behind')
  })

  test('returns "minor-behind" for minor difference (1.1.0 vs 1.2.3)', () => {
    const current = semver.parse('1.1.0')!
    const target = semver.parse('1.2.3')!
    assert.strictEqual(compareVersionDiff(current, target), 'minor-behind')
  })

  test('returns "major-behind" for major difference (1.2.3 vs 2.0.0)', () => {
    const current = semver.parse('1.2.3')!
    const target = semver.parse('2.0.0')!
    assert.strictEqual(compareVersionDiff(current, target), 'major-behind')
  })

  test('returns "patch-behind" for prerelease difference (1.0.0-alpha vs 1.0.0)', () => {
    const current = semver.parse('1.0.0-alpha')!
    const target = semver.parse('1.0.0')!
    assert.strictEqual(compareVersionDiff(current, target), 'patch-behind')
  })
})

describe('computeStatus', () => {
  test('returns "latest" when specified version equals latest', () => {
    const range = parseVersionRange('1.2.3')!
    const latest = semver.parse('1.2.3')!
    assert.strictEqual(computeStatus(range, latest, latest), 'latest')
  })

  test('returns "minor-behind" for 1.1.0 vs latest 1.2.3', () => {
    const range = parseVersionRange('1.1.0')!
    const latest = semver.parse('1.2.3')!
    assert.strictEqual(computeStatus(range, latest, latest), 'minor-behind')
  })

  test('returns "patch-behind" for 1.2.0 vs latest 1.2.3', () => {
    const range = parseVersionRange('1.2.0')!
    const latest = semver.parse('1.2.3')!
    assert.strictEqual(computeStatus(range, latest, latest), 'patch-behind')
  })

  test('returns "major-behind" for 0.9.0 vs latest 1.0.0', () => {
    const range = parseVersionRange('0.9.0')!
    const latest = semver.parse('1.0.0')!
    assert.strictEqual(computeStatus(range, latest, latest), 'major-behind')
  })

  test('returns "error" when latest is undefined', () => {
    const range = parseVersionRange('1.0.0')!
    assert.strictEqual(computeStatus(range, undefined, undefined), 'error')
  })

  test('compares against latestStable when available', () => {
    const range = parseVersionRange('1.0.0')!
    const latestStable = semver.parse('1.2.0')!
    const latest = semver.parse('2.0.0-beta')! // prerelease is latest but not stable
    // Should compare against latestStable (1.2.0), not latest (2.0.0-beta)
    assert.strictEqual(computeStatus(range, latestStable, latest), 'minor-behind')
  })
})

describe('semver range.test() for version matching', () => {
  test('Cargo caret ranges work correctly', () => {
    const versions = ['0.0.1', '0.1.0', '1.0.0', '1.2.3', '2.0.0'].map((v) => semver.parse(v)!)

    // Cargo default: ^version (compatible versions)
    const range1 = parseVersionRange('1.2.3')! // ^1.2.3
    const range2 = parseVersionRange('0.0.1')! // ^0.0.1 (only 0.0.1)
    const range3 = parseVersionRange('0.1.0')! // ^0.1.0 (0.1.x)

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
