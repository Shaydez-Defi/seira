| Contract | Address |
|---|---|
| TestSwapAdapter | 0x1A9e28052f54b300adC845AD244b2D17E8ECc947 |
| FXRP | 0x0b6A3645c240605887a5532109323A3E12273dc7 |
| USDT0 | 0xC1A5B41512496B80903D1f32d6dEa3a73212E71F |
| WFLR | 0xaB6FaD89389B73dBC887d31206A26Fd88d719d1F |

## What was built during this hackathon

The entire stack, from an empty repository: core types, capability registry, execution planner, execution runtime, the swap contract, the API, the FTSO price integration, and the frontend. See commit history for the full build timeline.

## Tech stack

TypeScript, Node.js, Hardhat, Express, React (Vite), ethers v6, vitest.

## Repository structure

packages/
  core/        shared types: PaymentIntent, CapabilityEntry, ExecutionPlan
  registry/    Capability Registry, FTSO price feed integration
  planner/     Execution Planner: constraint solving and route scoring
  runtime/     Execution Runtime: on-chain execution and compensating actions
  contracts/   TestSwapAdapter, Hardhat deployment and setup scripts
  api/         Express API connecting the frontend to Planner and Runtime
  frontend/    React application

## Roadmap

- Live DEX integration once a Coston2 deployment with confirmed liquidity is available, or on Flare mainnet
- Real FXRP minting flow (XRPL deposit to FDC verification to mint), currently bypassed via the Coston2 faucet for demo purposes
- Broader asset support beyond FXRP, USDT0, WFLR
- Registry-driven rate refresh wired into the live request path, not just available as a standalone module

## License

MIT. See [LICENSE](./LICENSE).