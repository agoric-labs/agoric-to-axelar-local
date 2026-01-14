#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/network-config.sh"

if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <network> [owner_type]"
    echo ""
    echo "Arguments:"
    echo "  network        - Target network to deploy to"
    echo "  owner_type     - Optional: 'ymax0' or 'ymax1' (default: ymax0)"
    echo ""
    echo "Supported networks:"
    echo "  Mainnets: avax, arb, base, eth, opt"
    echo "  Testnets: eth-sepolia, fuji, base-sepolia, opt-sepolia, arb-sepolia"
    echo ""
    echo "Examples:"
    echo "  $0 eth-sepolia           # Deploy with ymax0 owner (default)"
    echo "  $0 eth-sepolia ymax0     # Deploy with ymax0 owner"
    echo "  $0 eth-sepolia ymax1     # Deploy with ymax1 owner"
    exit 0
fi

network=$1
owner_type=${2:-ymax0}

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

if [[ "$owner_type" != "ymax0" && "$owner_type" != "ymax1" ]]; then
    echo "Error: Invalid owner type '$owner_type'"
    echo "Valid options: 'ymax0' or 'ymax1'"
    exit 1
fi

# Set owner address based on network type and owner type
case $network in
    avax|arb|base|eth|opt|pol)
        # Mainnet
        if [[ "$owner_type" == "ymax0" ]]; then
            OWNER_ADDRESS="agoric1wl2529tfdlfvure7mw6zteam02prgaz88p0jru4tlzuxdawrdyys6jlmnq" # https://vstorage.agoric.net/?path=published.ymax0&endpoint=https%3A%2F%2Fmain-a.rpc.agoric.net%3A443&height=undefined
        else
            OWNER_ADDRESS="agoric13ecz27mm2ug5kv96jyal2k6z8874mxzs4m4yuet36s4nqdl0ey6qr09p74" # https://vstorage.agoric.net/?path=published.ymax1&endpoint=https%3A%2F%2Fmain-a.rpc.agoric.net%3A443&height=undefined
        fi
        ;;
    *)
        # Testnet
        if [[ "$owner_type" == "ymax0" ]]; then
            OWNER_ADDRESS="agoric18ek5td2h397cmejnlndes50k84ywx82kau7aff80t74fcxmjnzqstjclj0" # https://vstorage.agoric.net/?path=published.ymax0&endpoint=https%3A%2F%2Fdevnet.rpc.agoric.net%3A443&height=undefined
        else
            OWNER_ADDRESS="agoric1ps63986jnululzkmg7h3nhs5at6vkatcgsjy9ttgztykuaepwpxsrw2sus" # https://vstorage.agoric.net/?path=published.ymax1&endpoint=https%3A%2F%2Fdevnet.rpc.agoric.net%3A443&height=undefined
        fi
        ;;
esac

echo "Deploying DepositFactory (with Permit2 support)..."
echo "Using owner type: $owner_type"
echo "Using owner address: $OWNER_ADDRESS"
GATEWAY_CONTRACT="$GATEWAY" \
    GAS_SERVICE_CONTRACT="$GAS_SERVICE" \
    PERMIT2_CONTRACT="$PERMIT2" \
    OWNER_ADDRESS="$OWNER_ADDRESS" \
    npx hardhat ignition deploy "./ignition/modules/deployDepositFactory.ts" --network "$network" --verify
