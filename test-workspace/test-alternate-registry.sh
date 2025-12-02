#!/bin/bash

# Helper script to launch 2 local alternate registries, for testing purpose

set -eu

SCRIPT_DIR="$(dirname "$0")"

source "$SCRIPT_DIR/up-alternate-registry.sh"
bun "$SCRIPT_DIR/../src/cli/index.ts" -- "$SCRIPT_DIR/crates/example/Cargo.toml" $@
