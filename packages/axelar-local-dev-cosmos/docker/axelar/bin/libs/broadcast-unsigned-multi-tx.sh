#!/bin/bash

# Set Docker socket location for macOS - use the correct path for host machine
# export DOCKER_HOST=$(docker context inspect --format '{{.Endpoints.docker.Host}}')

CHAIN_ID=axelar
HOME=/root/private/.axelar
DEFAULT_KEYS_FLAGS="--keyring-backend test --home ${HOME}"
echo "--------------------------------- 4 ---------------------------------"
## Sign unsigned transaction.
docker exec axelar /bin/bash -c "axelard tx sign ${HOME}/unsigned_msg.json --from gov1 \
--multisig \$(axelard keys show governance -a ${DEFAULT_KEYS_FLAGS}) \
--chain-id $CHAIN_ID ${DEFAULT_KEYS_FLAGS} &> ${HOME}/signed_tx.json"
docker exec axelar /bin/bash -c "cat ${HOME}/signed_tx.json"
echo "--------------------------------- 5 ---------------------------------"
## Multisign signed transaction.
docker exec axelar /bin/bash -c "axelard tx multisign ${HOME}/unsigned_msg.json governance ${HOME}/signed_tx.json \
--from owner --chain-id $CHAIN_ID ${DEFAULT_KEYS_FLAGS} &> ${HOME}/tx-ms.json"
docker exec axelar /bin/bash -c "cat ${HOME}/tx-ms.json"
echo "--------------------------------- 6 ---------------------------------"
## Broadcast multisigned transaction.
docker exec axelar /bin/bash -c "axelard tx broadcast ${HOME}/tx-ms.json ${DEFAULT_KEYS_FLAGS}"
