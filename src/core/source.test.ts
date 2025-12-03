import assert from 'node:assert'
import { describe, test } from 'node:test'
import { getGitRawFileUrl } from './source.js'
import type { CustomGitHost } from './types.js'

describe('getGitRawFileUrl', () => {
  describe('GitHub public repositories', () => {
    test('handles HTTPS URL', () => {
      const result = getGitRawFileUrl('https://github.com/rust-lang/regex.git', 'main')
      assert.deepStrictEqual(result, {
        url: 'https://raw.githubusercontent.com/rust-lang/regex/main/Cargo.toml',
      })
    })

    test('handles HTTPS URL without .git suffix', () => {
      const result = getGitRawFileUrl('https://github.com/rust-lang/regex', 'main')
      assert.deepStrictEqual(result, {
        url: 'https://raw.githubusercontent.com/rust-lang/regex/main/Cargo.toml',
      })
    })

    test('handles SSH URL', () => {
      const result = getGitRawFileUrl('git@github.com:rust-lang/regex.git', 'v1.10.0')
      assert.deepStrictEqual(result, {
        url: 'https://raw.githubusercontent.com/rust-lang/regex/v1.10.0/Cargo.toml',
      })
    })

    test('handles crate name for workspace', () => {
      const result = getGitRawFileUrl('https://github.com/tokio-rs/tokio.git', 'master', 'tokio')
      assert.deepStrictEqual(result, {
        url: 'https://raw.githubusercontent.com/tokio-rs/tokio/master/tokio/Cargo.toml',
      })
    })
  })

  describe('GitLab public repositories', () => {
    test('handles HTTPS URL', () => {
      const result = getGitRawFileUrl('https://gitlab.com/user/project.git', 'main')
      assert.deepStrictEqual(result, {
        url: 'https://gitlab.com/user/project/-/raw/main/Cargo.toml',
      })
    })

    test('handles SSH URL', () => {
      const result = getGitRawFileUrl('git@gitlab.com:user/project.git', 'v1.0.0')
      assert.deepStrictEqual(result, {
        url: 'https://gitlab.com/user/project/-/raw/v1.0.0/Cargo.toml',
      })
    })

    test('handles crate name for workspace', () => {
      const result = getGitRawFileUrl('https://gitlab.com/user/project.git', 'main', 'my-crate')
      assert.deepStrictEqual(result, {
        url: 'https://gitlab.com/user/project/-/raw/main/my-crate/Cargo.toml',
      })
    })
  })

  describe('custom hosts (private repositories)', () => {
    const customHosts: CustomGitHost[] = [
      {
        host: 'github.mycompany.com',
        type: 'github',
        token: 'ghp_secret_token_123',
      },
      {
        host: 'gitlab.internal.org',
        type: 'gitlab',
        token: 'glpat_secret_token_456',
      },
    ]

    test('handles custom GitHub Enterprise HTTPS URL with token', () => {
      const result = getGitRawFileUrl(
        'https://github.mycompany.com/team/private-repo.git',
        'main',
        undefined,
        customHosts,
      )
      assert.deepStrictEqual(result, {
        url: 'https://github.mycompany.com/raw/team/private-repo/main/Cargo.toml',
        token: 'ghp_secret_token_123',
      })
    })

    test('handles custom GitHub Enterprise SSH URL with token', () => {
      const result = getGitRawFileUrl(
        'git@github.mycompany.com:team/private-repo.git',
        'develop',
        undefined,
        customHosts,
      )
      assert.deepStrictEqual(result, {
        url: 'https://github.mycompany.com/raw/team/private-repo/develop/Cargo.toml',
        token: 'ghp_secret_token_123',
      })
    })

    test('handles custom GitLab HTTPS URL with token', () => {
      const result = getGitRawFileUrl(
        'https://gitlab.internal.org/infra/rust-lib.git',
        'v2.0.0',
        undefined,
        customHosts,
      )
      assert.deepStrictEqual(result, {
        url: 'https://gitlab.internal.org/infra/rust-lib/-/raw/v2.0.0/Cargo.toml',
        token: 'glpat_secret_token_456',
      })
    })

    test('handles custom host with crate name for workspace', () => {
      const result = getGitRawFileUrl(
        'https://github.mycompany.com/team/mono-repo.git',
        'main',
        'my-crate',
        customHosts,
      )
      assert.deepStrictEqual(result, {
        url: 'https://github.mycompany.com/raw/team/mono-repo/main/my-crate/Cargo.toml',
        token: 'ghp_secret_token_123',
      })
    })

    test('custom host without token still works', () => {
      const hostsWithoutToken: CustomGitHost[] = [
        {
          host: 'git.example.com',
          type: 'github',
        },
      ]
      const result = getGitRawFileUrl('https://git.example.com/org/repo.git', 'main', undefined, hostsWithoutToken)
      assert.deepStrictEqual(result, {
        url: 'https://git.example.com/raw/org/repo/main/Cargo.toml',
        token: undefined,
      })
    })

    test('falls back to public GitHub when custom host does not match', () => {
      const result = getGitRawFileUrl('https://github.com/rust-lang/regex.git', 'main', undefined, customHosts)
      assert.deepStrictEqual(result, {
        url: 'https://raw.githubusercontent.com/rust-lang/regex/main/Cargo.toml',
      })
    })
  })

  describe('unsupported hosts', () => {
    test('returns undefined for unsupported host', () => {
      const result = getGitRawFileUrl('https://bitbucket.org/user/repo.git', 'main')
      assert.strictEqual(result, undefined)
    })

    test('returns undefined for custom git server without config', () => {
      const result = getGitRawFileUrl('https://git.mycompany.com/user/repo.git', 'main')
      assert.strictEqual(result, undefined)
    })
  })
})
