#!/bin/bash

# Set Docker socket location for macOS
export DOCKER_HOST=unix://${HOME}/.docker/run/docker.sock

CHAIN_ID=axelar
HOME=/root/private/.axelar
DEFAULT_KEYS_FLAGS="--keyring-backend test --home ${HOME}"
CHAIN=$1
DIR="$(dirname "$0")"

if [ -z "$CHAIN" ]
then
  echo "Chain name is required"
  exit 1
fi

# docker exec axelar /bin/bash -c "axelard tx evm add-chain ${CHAIN} /root/private/bin/libs/params.json --generate-only \
# --chain-id ${CHAIN_ID} --from \$(axelard keys show governance -a ${DEFAULT_KEYS_FLAGS}) --home ${HOME} \
# --output json --gas 500000 &> ${HOME}/unsigned_msg.json"

echo "--------------------------------- 1 ---------------------------------"

docker exec axelar /bin/bash -c "axelard tx evm add-chain ethereum /root/private/bin/libs/params.json --generate-only  --chain-id axelar --from \$(axelard keys show governance -a --keyring-backend test --home /root/private/.axelar) --home /root/private/.axelar --output json --gas 500000 &> /root/private/.axelar/unsigned_msg.json"

echo "--------------------------------- 2 ---------------------------------"

docker exec axelar /bin/bash -c "cat ${HOME}/unsigned_msg.json"

echo "--------------------------------- 3 ---------------------------------"
sh "$DIR/../libs/broadcast-unsigned-multi-tx.sh"

