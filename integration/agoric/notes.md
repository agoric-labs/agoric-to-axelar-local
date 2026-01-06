## FactoryFactory contract addresses

- Arbitrum: [0x52F4bfa3542cCE1bD93688728813E0ca91729024](https://sepolia.arbiscan.io/address/0x52F4bfa3542cCE1bD93688728813E0ca91729024)

## Ownable Factory addresses

- Chain - Owner tx address
- Arbitrum agoric1rwwley550k9mmk6uq6mm6z4udrg8kyuyvfszjk https://testnet.axelarscan.io/gmp/0x0ee3b58efbc5dd6c9ccfa72b0bc2cd365de883e6a332d3250081841c4ebdd89a-334041807 https://sepolia.arbiscan.io/address/0x4BD898791Dc02dCc50EaB1Cfd48b22F621979198

## Ownable Factory Addresses

| Chain    | Owner Tx Address                                | AxelarScan (GMP)                                                                                               | Explorer Address                                                                                                             |
| -------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Arbitrum | `agoric1rwwley550k9mmk6uq6mm6z4udrg8kyuyvfszjk` | https://testnet.axelarscan.io/gmp/0x0ee3b58efbc5dd6c9ccfa72b0bc2cd365de883e6a332d3250081841c4ebdd89a-334041807 | [0x4BD898791Dc02dCc50EaB1Cfd48b22F621979198](https://sepolia.arbiscan.io/address/0x4BD898791Dc02dCc50EaB1Cfd48b22F621979198) |

## Open questions

- Should `FactoryFactory` use GMP? Currently, we use an Axelar GMP call to create an ownable factory. Could we instead create it via a direct EVM transaction and manually pass the result to ymax-contract?

## Testing

tx failing when permit2 contract was not approved usdc:
https://testnet.axelarscan.io/gmp/0xd4048b63e364ffc16d93a4a2ee91748815f94a93d7dc305b3ce3c6ea8063f58e-334043259
https://testnet.axelarscan.io/gmp/0x76fd4ed59b43589d38c06e40a9d3750b8f1decf2c210c6d82e5d1fc2b76e772a-334044258

tx failing when spender is not factory:
https://testnet.axelarscan.io/gmp/0xe381c30524bbec95e6740f0fc3ca096bf1e4377db05151229b37ad7384f08b3a-334044733


tests remain:
- invoking factory with wrong owner
- invoking remote wallet to do things
- invoing remote wallet with wrong owner