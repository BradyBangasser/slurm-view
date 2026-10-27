#!/usr/bin/env bash
# Build fully static (musl) rpc and client binaries in a container, so they
# run on any x86_64 Linux login node regardless of its glibc version.
#
#   ./build-static.sh            # -> dist/rpc, dist/client
#
# Uses podman, or docker if podman is missing.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENGINE="$(command -v podman || command -v docker || true)"
[[ -n "$ENGINE" ]] || { echo "podman or docker is required" >&2; exit 1; }

"$ENGINE" run --rm \
  -v "$ROOT:/src:z" \
  -v slurmview-cargo-registry:/usr/local/cargo/registry \
  -w /src/src/rpc \
  -e CARGO_TARGET_DIR=/src/src/rpc/target/musl \
  docker.io/library/rust:1.98-alpine \
  sh -euc 'apk add --no-cache musl-dev protobuf protobuf-dev >/dev/null
           cargo build --release --locked --bins'

mkdir -p "$HERE/dist"
cp "$HERE/target/musl/release/rpc" "$HERE/target/musl/release/client" "$HERE/dist/"
ls -lh "$HERE/dist"
