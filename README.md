# Fancy Crates

A VSCode extension helping Rust developers spot outdated dependencies in `Cargo.toml` manifest files.

Keeping dependencies up to date is essential for security patches, bug fixes, and new features. Fancy Crates shows version status directly in your editor as you work, helping you catch outdated dependencies early—before they accumulate into a major upgrade effort.

![Fancy Crates in Action](https://github.com/alfatm/fancy-crates/raw/main/fancy-crates-in-action.png)

📽️ [Presentation](https://htmlpreview.github.io/?https://github.com/alfatm/fancy-crates/blob/main/presentation.html)

## Features

- Cargo's [sparse protocol](https://rust-lang.github.io/rfcs/2789-sparse-index.html) for fast index lookups
- Granular version status: ✅ latest, 🟨 patch behind, 🟧 minor behind, 🟥 major behind
- **Security advisory warnings** via `cargo-deny` integration (optional)
- Remote and local crates.io mirrors (HTTP/HTTPS/file URLs)
- Alternate registries with authentication token support
- Automatic registry detection from `.cargo/config.toml`
- Package rename support
- Detailed logs in VSCode output channel

## Status Indicators

| Symbol | Status       | Meaning                                            |
| ------ | ------------ | -------------------------------------------------- |
| ✅      | latest       | Latest stable version satisfies your requirement   |
| 🟨      | patch-behind | Patch update available                             |
| 🟧      | minor-behind | Minor update available                             |
| 🟥      | major-behind | Major update available                             |
| ❗      | error        | Failed to fetch crate info or no matching versions |
| 🚨      | advisory     | Security advisory detected (requires `cargo-deny`) |

## Version Requirements

Fancy Crates uses [Cargo's version requirement syntax](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html). A dependency is considered **up-to-date** if the latest stable version satisfies the specified range.

### Exact vs Range Versions

Fancy Crates distinguishes between **exact versions** and **range versions**:

- **Exact versions** (`1.2.3`, `0.5.0`) — compared directly against latest. If you specify `1.2.3` and latest is `1.2.4`, you'll see 🟨 patch-behind.
- **Short/range versions** (`1`, `1.2`, `^1.2.3`, `~1.2.3`) — evaluated as ranges. If you specify `1` and latest is `1.9.0`, you'll see ✅ latest because `1.9.0` satisfies `>=1.0.0, <2.0.0`.

### Range Version Syntax

When you specify a short version or use operators, Cargo interprets it as a range:

| Requirement | Equivalent Range  | Example Matches     |
| ----------- | ----------------- | ------------------- |
| `1.2`       | `>=1.2.0, <2.0.0` | 1.2.0, 1.3.0, 1.9.9 |
| `1`         | `>=1.0.0, <2.0.0` | 1.0.0, 1.5.0, 1.9.9 |
| `0.2`       | `>=0.2.0, <0.3.0` | 0.2.0, 0.2.9        |
| `0.0`       | `>=0.0.0, <0.1.0` | 0.0.0, 0.0.9        |
| `0`         | `>=0.0.0, <1.0.0` | 0.0.0, 0.5.0, 0.9.9 |
| `^1.2.3`    | `>=1.2.3, <2.0.0` | 1.2.3, 1.3.0, 1.9.9 |
| `~1.2.3`    | `>=1.2.3, <1.3.0` | 1.2.3, 1.2.9        |

### Examples

- `tokio = "1"` with latest `1.40.0` → ✅ (range: 1.40.0 satisfies `>=1.0.0, <2.0.0`)
- `serde = "1.0"` with latest `1.0.210` → ✅ (range: 1.0.210 satisfies `>=1.0.0, <2.0.0`)
- `serde = "1.0.200"` with latest `1.0.210` → 🟨 patch-behind (exact: 1.0.200 < 1.0.210)
- `clap = "3"` with latest `4.5.0` → 🟥 major-behind (range: 4.5.0 doesn't satisfy `>=3.0.0, <4.0.0`)
- `rand = "0.7"` with latest `0.8.5` → 🟧 minor-behind (range: 0.8.5 doesn't satisfy `>=0.7.0, <0.8.0`)
- `rand = "0.8.4"` with latest `0.8.5` → 🟨 patch-behind (exact: 0.8.4 < 0.8.5)

## Security Advisories

Fancy Crates integrates with [`cargo-deny`](https://embarkstudios.github.io/cargo-deny/) to check your dependencies against the [RustSec Advisory Database](https://rustsec.org/).

### Setup

Install `cargo-deny`:

```bash
cargo install cargo-deny
```

That's it! Fancy Crates will automatically detect `cargo-deny` and display security warnings.

### How It Works

When you open a `Cargo.toml`, Fancy Crates runs `cargo deny check advisories` in the background. If any dependency has a known vulnerability, you'll see:

- 🚨 emoji in the decoration (e.g., `🚨 ✅` or `🚨 🟧 1.5.0`)
- Detailed advisory information in the hover tooltip, including:
  - Advisory ID with link to RustSec
  - Severity level
  - Description
  - Recommended solution

### Advisory Types

| Emoji | Type         | Meaning                              |
| ----- | ------------ | ------------------------------------ |
| 🚨    | vulnerability | Security vulnerability               |
| ⚠️    | unmaintained | Package is no longer maintained      |
| 💀    | unsound      | Contains undefined behavior          |
| ℹ️    | notice       | General notice                       |
| 🗑️    | yanked       | Version has been yanked from registry |

## Configuration

- `fancy-crates.useCargoCache`: If true, Cargo's index cache is searched first before the registries. Cache must be stored in the sparse format.

- `fancy-crates.cratesIoIndex`: The index URL of the default crates.io registry. Change this value only if you use a remote or local mirror of crates.io. The index must use the sparse protocol. Use a file URL if the mirror is on disk.

- `fancy-crates.cratesIoCache`: The index cache directory of the default crates.io registry. Change this value only if you use a remote or local mirror of crates.io. You can find the directories at CARGO_HOME/registry/index.

- `fancy-crates.registries`: An array of alternate registries. Each registry object has the following properties:
  - `name` (required): Registry name matching dependencies' `registry` key
  - `index` (required): Index URL (sparse protocol, supports `file://` for local)
  - `cache` (optional): Cargo's index cache directory at `CARGO_HOME/registry/index`
  - `docs` (optional): Docs URL template, used for hover links as `${docs}${name}/${version}`

## Commands

- **Fancy Crates: Refresh Dependencies** — Re-check dependencies for all visible `Cargo.toml` files
- **Fancy Crates: Reload (Clear Cache)** — Clear all caches (versions, cargo config, CLI tools) and reload the current file

## Disabling Checks

You can skip version checking for specific dependencies or entire files using comments.

### Disable a Single Dependency

Add `# crates: disable-check` comment on the dependency line:

```toml
[dependencies]
serde = "1.0"
legacy-crate = "0.1.0"  # crates: disable-check
tokio = "1"
```

### Disable All Checks in a File

Add `#! crates: disable-check` at the beginning of the file:

```toml
#! crates: disable-check
[package]
name = "my-crate"
version = "0.1.0"

[dependencies]
# All dependencies in this file will be skipped
```

Comments are case-insensitive and allow flexible spacing (e.g., `#crates:disable-check` also works).

## CLI

A standalone CLI tool is included for CI/CD pipelines and terminal usage.

### Installation

```bash
# Build the CLI
pnpm run build:cli

# Run directly
node dist/cli.cjs ./Cargo.toml
```

### Usage

```bash
fancy-crates-cli <path-to-Cargo.toml> [options]

Options:
  --filter <name>        Filter by dependency name (partial match)
  --line <num>           Filter by line number
  --show-plugin          Show output as VSCode plugin would display it
  --no-cache             Disable Cargo cache lookup
  --json                 Output results as JSON
  -v, --verbose          Verbosity level: -v warn/error, -vv info, -vvv debug
  --registry <name=url>  Add alternate registry (overrides cargo config)
```

### Examples

```bash
# Check all dependencies
fancy-crates-cli ./Cargo.toml

# Filter by name
fancy-crates-cli ./Cargo.toml --filter serde

# JSON output for scripting
fancy-crates-cli ./Cargo.toml --json > output.json

# Use custom registry
fancy-crates-cli ./Cargo.toml --registry my-registry=https://my-registry.example.com/api/v1/crates/
```

### Exit Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 0    | All dependencies are up to date         |
| 1    | Patch or minor updates available        |
| 2    | Major updates available                 |
| 3    | Errors occurred (e.g., crate not found) |

## Programmatic API

Fancy Crates provides a full programmatic API for batch analysis and custom tooling. Perfect for:

- **CI/CD Integration** — Automated dependency checks in your pipeline
- **Workspace Analysis** — Analyze multiple crates at once
- **Security Audits** — Find outdated or vulnerable dependencies
- **Custom Reports** — Generate dependency reports in any format

### Quick Start

```typescript
import { validateCrate, validateBatch, toJsonWithSummary } from 'fancy-crates/api'

// Analyze a single crate
const result = await validateCrate('./Cargo.toml')
const json = toJsonWithSummary(result)
console.log(`${json.summary.majorBehind} dependencies need major updates`)

// Batch analyze a workspace
const batch = await validateBatch({
  rootDir: './my-workspace',
  concurrency: 5
})
console.log(`Analyzed ${batch.totalFiles} crates with ${batch.totalDependencies} dependencies`)
```

### Features

- **Single & Batch Analysis** — Analyze one file or entire workspace
- **JSON Export** — Structured output for integration with other tools
- **Concurrent Processing** — Fast analysis with configurable concurrency
- **Custom Registries** — Support for private and alternate registries
- **Flexible Logging** — Debug output for troubleshooting

### Documentation

See [API.md](./API.md) for complete API documentation and examples.

### Examples

Check out the [examples](./examples) directory for ready-to-use scripts:

- **[single-crate.ts](./examples/single-crate.ts)** — Analyze a single Cargo.toml
- **[batch-analysis.ts](./examples/batch-analysis.ts)** — Batch analyze workspace with report generation
- **[custom-registry.ts](./examples/custom-registry.ts)** — Use private/custom registries
- **[security-audit.ts](./examples/security-audit.ts)** — Security audit for CI/CD

### Running Examples

```bash
# Build examples
pnpm run build:cli

# Run an example
node dist/examples/single-crate.cjs ./Cargo.toml
node dist/examples/batch-analysis.cjs ./workspace
node dist/examples/security-audit.cjs .
```

## Planned Features

- Status bar items and notifications

## Acknowledgments

This project is a fork of [**sparse-crates**](https://github.com/citreae535/sparse-crates) by [citreae535](https://github.com/citreae535), which itself was a fork of [**crates**](https://github.com/serayuzgur/crates) by [Seray Uzgur](https://github.com/serayuzgur).
