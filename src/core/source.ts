import { exec } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import semver from 'semver'
import { parseTOML } from 'toml-eslint-parser'
import type { TOMLKeyValue, TOMLTable } from 'toml-eslint-parser/lib/ast/ast.js'

import type { CliToolsAvailability, CustomGitHost, DependencySource, FetchOptions } from './types.js'

const execAsync = promisify(exec)

/** Cached CLI tools availability check result */
let cliToolsCache: CliToolsAvailability | undefined

/**
 * Check if required CLI tools are available on the system.
 * Results are cached for the lifetime of the process.
 */
export async function checkCliToolsAvailability(): Promise<CliToolsAvailability> {
  if (cliToolsCache) {
    return cliToolsCache
  }

  const checkCommand = async (cmd: string): Promise<boolean> => {
    try {
      await execAsync(`command -v ${cmd}`, { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  const [git, sh, tar] = await Promise.all([checkCommand('git'), checkCommand('sh'), checkCommand('tar')])

  cliToolsCache = { git, sh, tar }
  return cliToolsCache
}

/**
 * Reset CLI tools cache (useful for testing)
 */
export function resetCliToolsCache(): void {
  cliToolsCache = undefined
}

/**
 * Result of resolving a dependency source
 */
export interface SourceResolution {
  /** The version from the source's Cargo.toml */
  version: semver.SemVer | undefined
  /** Error if resolution failed */
  error?: Error
}

/**
 * Resolves the version from a dependency source (path or git).
 * For registry dependencies, returns undefined (handled by fetchVersions).
 */
export function resolveSourceVersion(
  source: DependencySource,
  crateName: string,
  cargoTomlDir: string,
  options?: FetchOptions,
): Promise<SourceResolution> {
  if (source.type === 'registry') {
    return Promise.resolve({ version: undefined })
  }

  if (source.type === 'path') {
    return resolvePathVersion(source.path, crateName, cargoTomlDir, options)
  }

  if (source.type === 'git') {
    return resolveGitVersion(source.git, crateName, source.branch, source.tag, source.rev, options)
  }

  return Promise.resolve({ version: undefined })
}

/**
 * Reads the version from a local path dependency's Cargo.toml
 */
async function resolvePathVersion(
  depPath: string,
  _crateName: string,
  cargoTomlDir: string,
  options?: FetchOptions,
): Promise<SourceResolution> {
  try {
    // Resolve relative path
    const absolutePath = path.isAbsolute(depPath) ? depPath : path.resolve(cargoTomlDir, depPath)
    const cargoTomlPath = path.join(absolutePath, 'Cargo.toml')

    options?.logger?.debug(`Reading path dependency from: ${cargoTomlPath}`)

    const content = await readFile(cargoTomlPath, 'utf-8')
    const version = extractVersionFromCargoToml(content)

    if (version) {
      options?.logger?.debug(`Found version ${version} in path dependency`)
      return { version }
    }

    return {
      version: undefined,
      error: new Error(`No version found in ${cargoTomlPath}`),
    }
  } catch (err) {
    return {
      version: undefined,
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}

/**
 * Fetches the version from a git repository's Cargo.toml
 * First tries HTTP fetch for GitHub/GitLab, then falls back to git CLI
 */
async function resolveGitVersion(
  gitUrl: string,
  crateName: string,
  branch?: string,
  tag?: string,
  rev?: string,
  options?: FetchOptions,
): Promise<SourceResolution> {
  // Determine the git ref to use
  const ref = rev || tag || branch || 'HEAD'

  // First, try HTTP fetch for known hosts (GitHub/GitLab)
  const httpResult = await tryHttpFetch(gitUrl, ref, crateName, options)
  if (httpResult.version) {
    return httpResult
  }

  // If HTTP failed, try git CLI (works with SSH keys, private repos, etc.)
  options?.logger?.debug(`HTTP fetch failed, trying git CLI for: ${gitUrl}`)
  const cliResult = await tryGitCliFetch(gitUrl, ref, crateName, options)
  if (cliResult.version) {
    return cliResult
  }

  // Return the more informative error
  return httpResult.error ? httpResult : cliResult
}

/**
 * Build headers for git HTTP fetch
 */
function buildGitFetchHeaders(userAgent?: string, token?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (userAgent) {
    headers['User-Agent'] = userAgent
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

/**
 * Try to fetch Cargo.toml via HTTP for GitHub/GitLab
 */
async function tryHttpFetch(
  gitUrl: string,
  ref: string,
  crateName: string,
  options?: FetchOptions,
): Promise<SourceResolution> {
  try {
    const customHosts = options?.gitOptions?.customHosts

    // Convert git URL to raw file URL for GitHub/GitLab
    const rawUrlResult = getGitRawFileUrl(gitUrl, ref, crateName, customHosts)

    if (!rawUrlResult) {
      options?.logger?.debug(`Cannot determine raw URL for git dependency: ${gitUrl}`)
      return {
        version: undefined,
        error: new Error(`Unsupported git host for HTTP fetch: ${gitUrl}`),
      }
    }

    options?.logger?.debug(`Fetching git dependency Cargo.toml from: ${rawUrlResult.url}`)

    const headers = buildGitFetchHeaders(options?.userAgent, rawUrlResult.token)
    const response = await fetch(rawUrlResult.url, {
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    })

    if (!response.ok) {
      // Try root Cargo.toml if crate-specific path failed
      const rootRawUrlResult = getGitRawFileUrl(gitUrl, ref, undefined, customHosts)
      if (rootRawUrlResult && rootRawUrlResult.url !== rawUrlResult.url) {
        options?.logger?.debug(`Trying root Cargo.toml: ${rootRawUrlResult.url}`)
        const rootHeaders = buildGitFetchHeaders(options?.userAgent, rootRawUrlResult.token)
        const rootResponse = await fetch(rootRawUrlResult.url, {
          headers: Object.keys(rootHeaders).length > 0 ? rootHeaders : undefined,
        })
        if (rootResponse.ok) {
          const content = await rootResponse.text()
          const version = extractVersionFromCargoToml(content)
          if (version) {
            options?.logger?.debug(`Found version ${version} in git dependency root`)
            return { version }
          }
        }
      }

      return {
        version: undefined,
        error: new Error(`HTTP fetch failed: ${response.status} ${response.statusText}`),
      }
    }

    const content = await response.text()
    const version = extractVersionFromCargoToml(content)

    if (version) {
      options?.logger?.debug(`Found version ${version} in git dependency via HTTP`)
      return { version }
    }

    return {
      version: undefined,
      error: new Error(`No version found in git repository ${gitUrl}`),
    }
  } catch (err) {
    return {
      version: undefined,
      error: err instanceof Error ? err : new Error(String(err)),
    }
  }
}

/**
 * Try to fetch Cargo.toml using git CLI (supports SSH, private repos)
 */
async function tryGitCliFetch(
  gitUrl: string,
  ref: string,
  crateName: string,
  options?: FetchOptions,
): Promise<SourceResolution> {
  const gitOptions = options?.gitOptions

  // Method 1: Try git archive if enabled (requires git, sh, tar)
  if (gitOptions?.enableGitArchive) {
    const cliTools = await checkCliToolsAvailability()
    if (cliTools.git && cliTools.sh && cliTools.tar) {
      const archiveResult = await tryGitArchive(gitUrl, ref, crateName, options)
      if (archiveResult.version) {
        return archiveResult
      }
    } else {
      options?.logger?.debug(
        `Skipping git archive: missing CLI tools (git=${cliTools.git}, sh=${cliTools.sh}, tar=${cliTools.tar})`,
      )
    }
  }

  // Method 2: Try shallow clone if enabled (experimental, requires git)
  if (gitOptions?.enableShallowClone) {
    const cliTools = await checkCliToolsAvailability()
    if (cliTools.git) {
      const cloneResult = await tryShallowClone(gitUrl, ref, crateName, options)
      if (cloneResult.version) {
        return cloneResult
      }
    } else {
      options?.logger?.debug('Skipping shallow clone: git not available')
    }
  }

  return {
    version: undefined,
    error: new Error(`Could not fetch Cargo.toml from ${gitUrl} via git CLI (CLI methods disabled or unavailable)`),
  }
}

/**
 * Try git archive --remote (works with some git servers that support it)
 */
async function tryGitArchive(
  gitUrl: string,
  ref: string,
  crateName: string,
  options?: FetchOptions,
): Promise<SourceResolution> {
  const paths = crateName ? [`${crateName}/Cargo.toml`, 'Cargo.toml'] : ['Cargo.toml']

  for (const filePath of paths) {
    try {
      options?.logger?.debug(`Trying git archive for ${gitUrl} ref=${ref} path=${filePath}`)

      const { stdout } = await execAsync(
        `git archive --remote="${gitUrl}" "${ref}" "${filePath}" 2>/dev/null | tar -xO`,
        {
          timeout: 30000,
        },
      )

      const version = extractVersionFromCargoToml(stdout)
      if (version) {
        options?.logger?.debug(`Found version ${version} via git archive`)
        return { version }
      }
    } catch {
      options?.logger?.debug(`git archive attempt failed for ${gitUrl} ref=${ref} path=${filePath}`)
      // Try next path
    }
  }

  return { version: undefined }
}

/**
 * Try shallow clone with sparse checkout to get just Cargo.toml
 */
async function tryShallowClone(
  gitUrl: string,
  ref: string,
  crateName: string,
  options?: FetchOptions,
): Promise<SourceResolution> {
  let tempDir: string | undefined

  try {
    // Create temp directory
    tempDir = await mkdtemp(path.join(tmpdir(), 'fancy-crates-git-'))
    options?.logger?.debug(`Created temp dir: ${tempDir}`)

    // Determine the branch/tag/ref to checkout
    // For SHA refs, we need to fetch specifically
    const isSha = /^[0-9a-f]{7,40}$/i.test(ref)

    // Initialize sparse checkout
    await execAsync(`git init`, { cwd: tempDir, timeout: 10000 })
    await execAsync(`git remote add origin "${gitUrl}"`, { cwd: tempDir, timeout: 10000 })

    // Configure sparse checkout to only get Cargo.toml files
    await execAsync(`git config core.sparseCheckout true`, { cwd: tempDir, timeout: 5000 })

    // Write sparse checkout patterns
    const patterns = crateName ? [`${crateName}/Cargo.toml`, 'Cargo.toml'] : ['Cargo.toml']
    const sparseCheckoutPath = path.join(tempDir, '.git', 'info', 'sparse-checkout')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(sparseCheckoutPath, `${patterns.join('\n')}\n`)

    // Fetch with depth 1
    if (isSha) {
      // For SHA, we need to fetch the specific commit
      options?.logger?.debug(`Fetching SHA ${ref} from ${gitUrl}`)
      await execAsync(`git fetch --depth 1 origin "${ref}"`, { cwd: tempDir, timeout: 60000 })
      await execAsync(`git checkout FETCH_HEAD`, { cwd: tempDir, timeout: 10000 })
    } else {
      // For branches/tags, use standard fetch
      options?.logger?.debug(`Fetching ref ${ref} from ${gitUrl}`)
      try {
        await execAsync(`git fetch --depth 1 origin "${ref}"`, { cwd: tempDir, timeout: 60000 })
        await execAsync(`git checkout FETCH_HEAD`, { cwd: tempDir, timeout: 10000 })
      } catch {
        // Try as branch name
        await execAsync(`git fetch --depth 1 origin "refs/heads/${ref}:refs/remotes/origin/${ref}"`, {
          cwd: tempDir,
          timeout: 60000,
        })
        await execAsync(`git checkout "origin/${ref}"`, { cwd: tempDir, timeout: 10000 })
      }
    }

    // Try to read Cargo.toml from the cloned repo
    for (const filePath of patterns) {
      try {
        const cargoTomlPath = path.join(tempDir, filePath)
        options?.logger?.debug(`Reading ${cargoTomlPath}`)
        const content = await readFile(cargoTomlPath, 'utf-8')
        const version = extractVersionFromCargoToml(content)
        if (version) {
          options?.logger?.debug(`Found version ${version} via shallow clone`)
          return { version }
        }
      } catch {
        // Try next path
      }
    }

    return { version: undefined }
  } catch (err) {
    options?.logger?.debug(`Shallow clone failed: ${err instanceof Error ? err.message : String(err)}`)
    return { version: undefined }
  } finally {
    // Cleanup temp directory
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true })
        options?.logger?.debug(`Cleaned up temp dir: ${tempDir}`)
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Result of resolving a git raw file URL
 */
export interface GitRawUrlResult {
  url: string
  token?: string
}

/**
 * Converts a git URL to a raw file URL for fetching Cargo.toml
 * Supports GitHub, GitLab, and custom hosts
 */
export function getGitRawFileUrl(
  gitUrl: string,
  ref: string,
  crateName?: string,
  customHosts?: CustomGitHost[],
): GitRawUrlResult | undefined {
  // Normalize the URL
  let url = gitUrl.trim()

  // Remove .git suffix if present
  if (url.endsWith('.git')) {
    url = url.slice(0, -4)
  }

  const filePath = crateName ? `${crateName}/Cargo.toml` : 'Cargo.toml'

  // Check custom hosts first
  if (customHosts) {
    for (const customHost of customHosts) {
      const hostPattern = customHost.host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const hostRegex = new RegExp(`${hostPattern}[/:]([^/]+)/([^/]+)`)
      const match = url.match(hostRegex)
      if (match) {
        const [, owner, repo] = match
        if (customHost.type === 'github') {
          return {
            url: `https://${customHost.host}/raw/${owner}/${repo}/${ref}/${filePath}`,
            token: customHost.token,
          }
        }
        if (customHost.type === 'gitlab') {
          return {
            url: `https://${customHost.host}/${owner}/${repo}/-/raw/${ref}/${filePath}`,
            token: customHost.token,
          }
        }
      }
    }
  }

  // Handle GitHub
  const githubMatch = url.match(/github\.com[/:]([^/]+)\/([^/]+)/)
  if (githubMatch) {
    const [, owner, repo] = githubMatch
    return {
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`,
    }
  }

  // Handle GitLab
  const gitlabMatch = url.match(/gitlab\.com[/:]([^/]+)\/([^/]+)/)
  if (gitlabMatch) {
    const [, owner, repo] = gitlabMatch
    return {
      url: `https://gitlab.com/${owner}/${repo}/-/raw/${ref}/${filePath}`,
    }
  }

  return undefined
}

/**
 * Extracts the version from a Cargo.toml content string
 */
function extractVersionFromCargoToml(content: string): semver.SemVer | undefined {
  try {
    const toml = parseTOML(content)

    // Find [package] table
    for (const node of toml.body[0].body) {
      if (node.type === 'TOMLTable') {
        const table = node as TOMLTable
        const keys = table.key.keys.map((k) => (k.type === 'TOMLBare' ? k.name : k.value))

        if (keys.length === 1 && keys[0] === 'package') {
          // Look for version in [package] table
          for (const kv of table.body) {
            if (kv.type === 'TOMLKeyValue') {
              const keyValue = kv as TOMLKeyValue
              const key = keyValue.key.keys[0]
              if (key && (key.type === 'TOMLBare' ? key.name : key.value) === 'version') {
                const value = keyValue.value
                if (value.type === 'TOMLValue' && value.kind === 'string') {
                  const parsed = semver.parse(value.value)
                  if (parsed) {
                    return parsed
                  }
                }
              }
            }
          }
        }
      } else if (node.type === 'TOMLKeyValue') {
        // Handle inline [package] key-value at top level (less common but valid)
        const kv = node as TOMLKeyValue
        const keys = kv.key.keys.map((k) => (k.type === 'TOMLBare' ? k.name : k.value))
        if (keys.length === 2 && keys[0] === 'package' && keys[1] === 'version') {
          const value = kv.value
          if (value.type === 'TOMLValue' && value.kind === 'string') {
            const parsed = semver.parse(value.value)
            if (parsed) {
              return parsed
            }
          }
        }
      }
    }

    return undefined
  } catch {
    return undefined
  }
}
