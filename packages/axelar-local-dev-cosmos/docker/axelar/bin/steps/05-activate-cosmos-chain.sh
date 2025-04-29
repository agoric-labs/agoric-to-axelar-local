#!/bin/bash

# Set Docker socket location for macOS
# export DOCKER_HOST=unix://${HOME}/.docker/run/docker.sock

CHAIN=${1:-wasm}
DIR="$(dirname "$0")"

sh "$DIR/../libs/activate-chain.sh" ${CHAIN}
