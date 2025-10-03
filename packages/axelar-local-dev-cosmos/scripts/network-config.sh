#!/bin/bash

# Mainnet and testnet contract addresses sourced from:
# Mainnet: https://docs.axelar.dev/dev/reference/mainnet-contract-addresses/
# Testnet: https://docs.axelar.dev/dev/reference/testnet-contract-addresses/
get_network_config() {
    local network=$1

    case $network in
    # Mainnets
    avax)
        GATEWAY='0x5029C0EFf6C34351a0CEc334542cDb22c7928f78'
        GAS_SERVICE='0x2d5d7d31F671F86C782533cc367F14109a082712'
        ;;
    arb)
        GATEWAY='0xe432150cce91c13a887f7D836923d5597adD8E31'
        GAS_SERVICE='0x2d5d7d31F671F86C782533cc367F14109a082712'
        ;;
    opt)
        GATEWAY='0xe432150cce91c13a887f7D836923d5597adD8E31'
        GAS_SERVICE='0x2d5d7d31F671F86C782533cc367F14109a082712'
        ;;
    pol)
        GATEWAY='0x6f015F16De9fC8791b234eF68D486d2bF203FBA8'
        GAS_SERVICE='0x2d5d7d31F671F86C782533cc367F14109a082712'
        ;;
    # Testnets
    eth-sepolia)
        GATEWAY='0xe432150cce91c13a887f7D836923d5597adD8E31'
        GAS_SERVICE='0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6'
        ;;
    fuji)
        GATEWAY='0xC249632c2D40b9001FE907806902f63038B737Ab'
        GAS_SERVICE='0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6'
        ;;
    base-sepolia)
        GATEWAY='0xe432150cce91c13a887f7D836923d5597adD8E31'
        GAS_SERVICE='0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6'
        ;;
    opt-sepolia)
        GATEWAY='0xe432150cce91c13a887f7D836923d5597adD8E31'
        GAS_SERVICE='0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6'
        ;;
    arb-sepolia)
        GATEWAY='0xe1cE95479C84e9809269227C7F8524aE051Ae77a'
        GAS_SERVICE='0xbE406F0189A0B4cf3A05C286473D23791Dd44Cc6'
        ;;
    *)
        echo "Invalid network specified"
        exit 1
        ;;
    esac
}
