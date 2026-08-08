# Seira

Settlement infrastructure for crypto payments where the payer and payee hold different assets.

## The problem

Most crypto payment systems assume the payer's asset and the payee's asset are the same. When they're not, the payer has to find a DEX, swap manually, absorb slippage, and hope nothing fails halfway through. Seira removes that requirement. A buyer pays in whatever they hold. A merchant receives whatever they asked for. One confirmation, no manual swapping on either side.

## Quickstart

Requires Node 18+ and a Coston2 testnet wallet funded with FXRP (from the [Flare faucet](https://faucet.flare.network/)).

```bash
git clone https://github.com/Shaydez-Defi/seira.git
cd seira
npm install
```

Set up environment variables (needed by the API and contracts packages):

```bash
cp packages/contracts/.env.example packages/contracts/.env
cp packages/contracts/.env packages/api/.env
```

Fill in COSTON2_RPC_URL and BACKEND_PRIVATE_KEY (a funded Coston2 testnet key, never a mainnet key).

Run the API and the frontend in separate terminals:

```bash
npm run dev --workspace=packages/api
cd packages/frontend
npm install
npm run dev
```

The frontend runs on localhost:5173 and proxies /api to the API running on localhost:3000, so the browser only ever talks to the frontend origin.

## Architecture

```text
Payment Intent
      |
      v
Intent Compiler        (normalizes a payment request into a structured intent)
      |
      v
Execution Planner       <---- Capability Registry
      |                        (tracks known asset routes: cost, latency,
      v                         reliability, reversibility, liquidity, rate)
Execution Runtime
      |
      v
Settlement + Verification
```

Intent Compiler. Takes a payment request (payer asset, receiver asset, amount, recipient, constraints) and produces a PaymentIntent.

Execution Planner. Builds a graph from the Capability Registry, enumerates feasible routes under the intent's constraints (max fee, deadline), scores the remaining routes on cost, latency, reliability, reversibility, and liquidity, and emits an ExecutionPlan of abstract steps: AcquireAsset, ConvertAsset, Transfer, VerifySettlement. The planner never references a specific protocol directly, only capabilities.

Execution Runtime. Executes the plan against real contracts on Coston2. Each ConvertAsset step resolves to a concrete adapter at execution time, not planning time, so adding a new venue is a runtime change, not a planner rewrite. If a step fails after an earlier reversible conversion succeeded, the runtime attempts a compensating action (reversing the conversion) rather than leaving funds mid-route.

Capability Registry. Not a static list. Adapter performance (reliability, latency, liquidity) can be updated from observed execution results over time, and rates can be refreshed from a live oracle rather than hardcoded.

## How this uses Flare

FAssets (FXRP). The payer-side asset in the demo flow is FXRP, Flare's trust-minimized representation of XRP. This is the interoperability primitive that makes the whole premise possible: value that originates on XRPL, usable natively in an EVM settlement flow.

FTSOv2. Live price data (XRP/USD, FLR/USD) is pulled directly from Flare's oracle via the FlareContractRegistry at 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019, rather than hardcoded exchange rates. See packages/registry/src/ftsoPriceFeed.ts.

Swap execution. Conversions currently execute against a self-deployed TestSwapAdapter contract on Coston2, not a third-party DEX. During development, no Coston2 DEX had confirmed, usable testnet liquidity for these pairs. Rather than build on an unreliable dependency, this spins up a minimal, fully-tested swap contract the project controls. Because the Runtime resolves adapters by capability rather than hardcoding a protocol, swapping in a live liquidity source later is a contained addition, not a rewrite.

## Deployed on Coston2

| Contract | Address |
|---|---|
| TestSwapAdapter | 0x1A9e28052f54b300adC845AD244b2D17E8ECc947 |
| FXRP | 0x0b6A3645c240605887a5532109323A3E12273dc7 |
| USDT0 | 0xC1A5B41512496B80903D1f32d6dEa3a73212E71F |
| WFLR | 0xaB6FaD89389B73dBC887d31206A26Fd88d719d1F |

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
