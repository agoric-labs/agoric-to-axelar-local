#!/bin/bash

# Set Docker socket location for macOS
# export DOCKER_HOST=$(docker context inspect --format '{{.Endpoints.docker.Host}}')

CHAIN=${1:-ethereum}
DIR="$(dirname "$0")"

sh "$DIR/../libs/activate-chain.sh" ${CHAIN}
