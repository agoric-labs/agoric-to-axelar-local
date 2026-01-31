#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/network-config.sh"

if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <network> <contract> [owner_type]"
    echo ""
    echo "Arguments:"
    echo "  network        - Target network to deploy to"
    echo "  contract       - 'factory', 'depositFactory', 'remoteAccountFactory', or 'portfolioRouter'"
    echo "  owner_type     - Optional: 'ymax0' or 'ymax1' (default: ymax0)"
    echo "                   Used for depositFactory and portfolioRouter (for AGORIC_LCA default)"
    echo ""
    echo "Supported networks:"
    echo "  Mainnets: avax, arb, base, eth, opt"
    echo "  Testnets: eth-sepolia, fuji, base-sepolia, opt-sepolia, arb-sepolia"
    echo ""
    echo "Examples:"
    echo "  $0 eth-sepolia factory              # Deploy Factory"
    echo "  $0 eth-sepolia depositFactory       # Deploy DepositFactory with ymax0 owner"
    echo "  $0 eth-sepolia depositFactory ymax0 # Deploy DepositFactory with ymax0 owner"
    echo "  $0 eth-sepolia depositFactory ymax1 # Deploy DepositFactory with ymax1 owner"
    echo "  $0 eth-sepolia remoteAccountFactory       # Deploy RemoteAccountFactory"
    echo "  $0 eth-sepolia portfolioRouter            # Deploy PortfolioRouter with ymax0 (requires REMOTE_ACCOUNT_FACTORY env var)"
    echo "  $0 eth-sepolia portfolioRouter ymax1      # Deploy PortfolioRouter with ymax1 AGORIC_LCA"
    exit 0
fi

network=$1
contract=$2
owner_type=${3:-ymax0}

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

# Validate contract parameter
if [[ "$contract" != "factory" && "$contract" != "depositFactory" && "$contract" != "remoteAccountFactory" && "$contract" != "portfolioRouter" ]]; then
    echo "Error: Invalid contract type '$contract'"
    echo "Valid options: 'factory', 'depositFactory', 'remoteAccountFactory', or 'portfolioRouter'"
    exit 1
fi

delete_deployments_folder "ignition/deployments"

# Deploy based on contract type
case "$contract" in
    factory)
        echo ""
        echo "========================================="
        echo "Deploying Factory (simple wallet factory)..."
        echo "========================================="
        GATEWAY_CONTRACT="$GATEWAY" \
            GAS_SERVICE_CONTRACT="$GAS_SERVICE" \
            npx hardhat ignition deploy "./ignition/modules/deployFactory.ts" --network "$network" --verify
        ;;

    depositFactory)
        if [ -z "$FACTORY" ]; then
            echo "Error: FACTORY environment variable is not set"
            echo "Please set FACTORY=0x... before deploying DepositFactory"
            echo "Example: FACTORY=0x1234...abcd npm run deploy eth-sepolia depositFactory"
            exit 1
        fi

        # Validate owner type for DepositFactory
        if [[ "$owner_type" != "ymax0" && "$owner_type" != "ymax1" ]]; then
            echo "Error: Invalid owner type '$owner_type'"
            echo "Valid options: 'ymax0' or 'ymax1'"
            exit 1
        fi

        # Set owner address based on network type and owner type
        case $network in
            avax|arb|base|eth|opt)
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

        echo ""
        echo "========================================="
        echo "Deploying DepositFactory (with Permit2 support)..."
        echo "========================================="
        echo "Using owner type: $owner_type"
        echo "Using owner address: $OWNER_ADDRESS"
        GATEWAY_CONTRACT="$GATEWAY" \
            GAS_SERVICE_CONTRACT="$GAS_SERVICE" \
            PERMIT2_CONTRACT="$PERMIT2" \
            FACTORY_CONTRACT="$FACTORY" \
            OWNER_ADDRESS="$OWNER_ADDRESS" \
            npx hardhat ignition deploy "./ignition/modules/deployDepositFactory.ts" --network "$network" --verify
        ;;

    remoteAccountFactory)
        echo ""
        echo "========================================="
        echo "Deploying RemoteAccountFactory..."
        echo "========================================="
        npx hardhat ignition deploy "./ignition/modules/deployRemoteAccountFactory.ts" --network "$network" --verify
        ;;

    portfolioRouter)
        if [ -z "$REMOTE_ACCOUNT_FACTORY" ]; then
            echo "Error: REMOTE_ACCOUNT_FACTORY environment variable is not set"
            echo "Please set REMOTE_ACCOUNT_FACTORY=0x... before deploying PortfolioRouter"
            echo "Example: REMOTE_ACCOUNT_FACTORY=0x1234...abcd $0 $network portfolioRouter"
            exit 1
        fi

        # Validate owner type for PortfolioRouter
        if [[ "$owner_type" != "ymax0" && "$owner_type" != "ymax1" ]]; then
            echo "Error: Invalid owner type '$owner_type'"
            echo "Valid options: 'ymax0' or 'ymax1'"
            exit 1
        fi

        # Set AGORIC_LCA based on network type and owner type if not provided
        if [ -z "$AGORIC_LCA" ]; then
            case $network in
                avax|arb|base|eth|opt)
                    # Mainnet
                    if [[ "$owner_type" == "ymax0" ]]; then
                        AGORIC_LCA="agoric1wl2529tfdlfvure7mw6zteam02prgaz88p0jru4tlzuxdawrdyys6jlmnq" # https://vstorage.agoric.net/?path=published.ymax0&endpoint=https%3A%2F%2Fmain-a.rpc.agoric.net%3A443&height=undefined
                    else
                        AGORIC_LCA="agoric13ecz27mm2ug5kv96jyal2k6z8874mxzs4m4yuet36s4nqdl0ey6qr09p74" # https://vstorage.agoric.net/?path=published.ymax1&endpoint=https%3A%2F%2Fmain-a.rpc.agoric.net%3A443&height=undefined
                    fi
                    ;;
                *)
                    # Testnet
                    if [[ "$owner_type" == "ymax0" ]]; then
                        AGORIC_LCA="agoric18ek5td2h397cmejnlndes50k84ywx82kau7aff80t74fcxmjnzqstjclj0" # https://vstorage.agoric.net/?path=published.ymax0&endpoint=https%3A%2F%2Fdevnet.rpc.agoric.net%3A443&height=undefined
                    else
                        AGORIC_LCA="agoric1ps63986jnululzkmg7h3nhs5at6vkatcgsjy9ttgztykuaepwpxsrw2sus" # https://vstorage.agoric.net/?path=published.ymax1&endpoint=https%3A%2F%2Fdevnet.rpc.agoric.net%3A443&height=undefined
                    fi
                    ;;
            esac
        fi

        echo ""
        echo "========================================="
        echo "Deploying PortfolioRouter..."
        echo "========================================="
        echo "Using owner type: $owner_type"
        echo "Using RemoteAccountFactory: $REMOTE_ACCOUNT_FACTORY"
        echo "Using Agoric LCA: $AGORIC_LCA"
        GATEWAY_CONTRACT="$GATEWAY" \
            FACTORY_CONTRACT="$REMOTE_ACCOUNT_FACTORY" \
            PERMIT2_CONTRACT="$PERMIT2" \
            AGORIC_LCA="$AGORIC_LCA" \
            npx hardhat ignition deploy "./ignition/modules/deployPortfolioRouter.ts" --network "$network" --verify
        ;;
esac

echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
