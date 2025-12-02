#!/bin/bash

# Helper script to launch 2 local alternate registries, for testing purpose

set -eu

# Detect container runtime
if command -v podman &>/dev/null; then
    CONTAINER=podman
elif command -v docker &>/dev/null; then
    CONTAINER=docker
else
    echo "[-] Please install docker or podman." >&2  # ошибки в stderr
    exit 1
fi

# Run alternate registries
$CONTAINER rm -f public-registry 2>/dev/null || true
$CONTAINER rm -f private-registry 2>/dev/null || true

echo "starting containers"
$CONTAINER run --rm -it -d -p 8000:8000 --name public-registry -e KELLNR_REGISTRY__AUTH_REQUIRED=false  -e KELLNR_ORIGIN__PORT=8000 ghcr.io/kellnr/kellnr:5.0.0
$CONTAINER run --rm -it -d -p 127.0.0.1:8001:8000 --name private-registry -e KELLNR_REGISTRY__AUTH_REQUIRED=true -e KELLNR_ORIGIN__PORT=8001 ghcr.io/kellnr/kellnr:5.0.0

SCRIPT_DIR="$(dirname "$0")"

# Push crate to `public-registry`
(
    cd "$SCRIPT_DIR/crates/external"
    cargo publish --allow-dirty --index "sparse+http://localhost:8000/api/v1/crates/" --token "Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD"
)

# Push crate to `private-registry`
(
    cd "$SCRIPT_DIR/crates/external2"
    cargo publish -v --allow-dirty --index "sparse+http://localhost:8001/api/v1/crates/" --token "Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD"
)

(
    cd "$SCRIPT_DIR/crates/external3"
    cargo publish -v --allow-dirty --index "sparse+http://localhost:8001/api/v1/crates/" --token "Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD"
)

# Check
curl --fail-with-body http://localhost:8000/api/v1/crates/ex/te/external
curl --fail-with-body -H "Authorization: Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD" http://localhost:8001/api/v1/crates/ex/te/external2

echo -e "\n\nhttp://localhost:8000"
echo -e "http://localhost:8001"

echo '
----------------
[registry]
global-credential-providers = ["cargo:token"]

[registries]
public-registry = { index = "sparse+http://localhost:8000/api/v1/crates/" }

[registries.private-registry]
index = "sparse+http://localhost:8001/api/v1/crates/"
token = "Zy9HhJ02RJmg0GCrgLfaCVfU6IwDfhXD"
----------------
'
