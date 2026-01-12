#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/network-config.sh"

if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <network> [contract]"
    echo "Supported networks:"
    echo "  Mainnets: avax, arb, base, eth, opt, pol"
    echo "  Testnets: eth-sepolia, fuji, base-sepolia, opt-sepolia, arb-sepolia"
    echo "Supported contracts (default: factory):"
    echo "  factory - Factory contract"
    echo "  wallethelper - WalletHelper contract"
    exit 0
fi

network=$1
contract=${2:-factory}

deploy_contract() {
    local contract_path=$1
    local gateway_contract=$2
    local gas_service_contract=$3

    GATEWAY_CONTRACT="$gateway_contract" \
        GAS_SERVICE_CONTRACT="$gas_service_contract" \
        npx hardhat ignition deploy "$contract_path" --network "$network" --verify
}

delete_deployments_folder() {
    local folder=$1
    if [ -d "$folder" ]; then
        echo "Deleting existing deployment folder: $folder"
        rm -rf "$folder"
    else
        echo "No existing deployment folder to delete: $folder"
    fi
}

get_network_config "$network"

delete_deployments_folder "ignition/deployments"

case "$contract" in
    factory)
        echo "Deploying Factory contract..."
        deploy_contract "./ignition/modules/deployFactory.ts" "$GATEWAY" "$GAS_SERVICE"
        ;;
    wallethelper)
        echo "Deploying WalletHelper contract..."
        npx hardhat ignition deploy "./ignition/modules/deployWalletHelper.ts" --network "$network" --verify
        ;;
    *)
        echo "Unknown contract: $contract"
        echo "Supported contracts: factory, wallethelper"
        exit 1
        ;;
esac
