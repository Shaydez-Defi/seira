# Seira — Complete Technical & Non-Technical Walkthrough

**What it is, in one sentence:** a crypto payment demo that lets a payer holding one asset (FXRP or WFLR) pay a merchant who wants a *different* asset (USDT0) — Seira plans the route, the user approves once, and it executes on-chain on the Coston2 testnet.

## Ground rules before the detail

- Everything runs on **Coston2 testnet** (chain id `114`), not mainnet. All funds are test tokens.
- All contract addresses are hardcoded constants (RPC, tokens, adapter) in both the backend and the frontend.
- There is exactly **one** adapter (`TestSwapAdapter`, a self-deployed swap contract) and **three** token types: `FXRP`, `USDT0`, `WFLR`.
- The "one tap" experience is real, but permissionless in the sense that **the browser signs** — there is no fee/quote database, no accounts, no authentication, and no persistence of payments.

## 0. The big picture (architecture)

```
Browser (React, App.jsx)
   │  fetch() to same-origin /api/*  (Vite proxy → localhost:3000, or Vercel rewrite → bundled Express)
   ▼
Express API (packages/api) ──────►  Capability Registry (asset routes)
   │                                     ▲  latency feedback on settle
   ├── /api/plan   POST
   ├── /api/quote  GET
   ├── /api/execute POST
   └── /api/relayer GET
   ▼
Execution Runtime (packages/runtime) ──►  Coston2 via ethers JSON-RPC
   │
   ▼
TestSwapAdapter.sol + FXRP/USDT0/WFLR ERC-20s (Coston2)
```

The five conceptual stages from the README map to code:

1. **PaymentIntent** → typed in `core/src/types.ts`, built in the browser.
2. **Planner** (`packages/planner`) → turns the intent into an `ExecutionPlan`, reading the registry.
3. **Registry** (`packages/registry`) → holds capability entries (rate, cost, latency, reliability, reversible, liquidity).
4. **Runtime** (`packages/runtime`) → executes the plan against live contracts.
5. **Settlement** → the recipient's `USDT0` balance increases; verified on-chain.

---

## 1. What the user sees (UI, screen by screen)

The single-page React app (`packages/frontend/src/App.jsx`, ~2850 lines, one file with inline CSS-in-a-string). There are **six screens**, switched by a `screen` state variable:

`landing → connect → create → confirm → status → (merchant)`

### Screen 1 — Landing page (`LandingScreen`)

Pure marketing: hero, an animated mock payment card, "How it works", a fake "Live Demo" widget whose routing is **simulated** with a `setTimeout` (1400ms) — it does **not** call the API. Scroll-reveal animations, hoverable architecture diagram, developer snippets. The only real interactivity is **Start Payment**, which calls `goTo("connect")`. Non-technically: it's a showcase page selling the idea.

### Screen 2 — Connect wallet (`ConnectScreen`)

Two ways to connect:

- **Injected wallet** (MetaMask/Rabby): calls `eth_requestAccounts`, then `ensureCoston2()` — if the wallet isn't on Coston2, it triggers `wallet_switchEthereumChain`; if the chain isn't known, `wallet_addEthereumChain` with the chain spec from the constant `COSTON2_NETWORK`.
- **WalletConnect** (mobile): dynamically imports `@walletconnect/ethereum-provider` (code-split so the injected path doesn't load it) and shows the wallet picker.

When connected, `resolveWalletSession()` does the following literally:

1. Wraps the EIP-1193 provider in a `BrowserProvider`, gets the signer address.
2. Uses a **separate read-only `JsonRpcProvider`** pointed at the public Coston2 RPC to call `balanceOf` on the FXRP and WFLR contracts, plus `decimals()` for each.
3. Returns `{ address, provider, fxrp, wflr }` (balances formatted with thousand-separators).

The UI shows both balances in a "Balance" card. **Nothing moves yet — it's read-only.**

### Screen 3 — Create payment (`CreateScreen`)

- Fields: **Pay to** (merchant name *or* wallet address), **They receive** (amount + asset, only `USDT0`), **You pay** (asset dropdown: `FXRP` or `WFLR`).
- As you type the amount, a **reverse quote** fires (debounced 400ms): it calls `GET /api/quote?fromAsset=<receiveAsset>&toAsset=<buyerAsset>&amount=<amount>`. This is how "You pay" gets filled in — it asks the API how much buyerAsset covers the typed receive amount. (Note the from/to inversion.)
- "Review Payment" is only enabled when recipient text is non-empty, a quote succeeded, and no error.

The payment draft keeps `convertedAmount` (the "You pay" number) for later display.

### Screen 4 — Confirm (`ConfirmScreen`)

On mount, it calls `POST /api/plan` with the built `PaymentIntent` (`App.jsx:2126`). The plan returns with:

- `estimatedTime` (a millisecond string, e.g. `"2500"` → displayed as `2.5 sec` via `formatEstimatedTime`)
- `estimatedCost` (a number string)
- `estimatedPayerAmount`
- `steps` (the Acquire/Convert/Transfer/Verify steps)

The screen shows: "You send X SYM → Merchant gets Y USDT0" via a nice animated line, "via Seira Router", a stat panel for **Estimated time** and **Estimated cost** (cost labeled `FLR`), and the **Confirm & Send** button.

### Screen 5 — Status (`StatusScreen`)

This is the real execution monitor. When the user taps Confirm (details in section 3), a progress ticker shows 4 steps — **Acquire → Convert → Transfer → Verify** — with a moving pink fill. When the receipt resolves:

- `settled` → "Payment complete", a receipt panel showing route, tx hash (shortened), and a **View as Merchant** button.
- `rolled_back` → "Payment rolled back" with the error message.
- `failed` or network error → an error panel.

### Screen 6 — Merchant (`MerchantScreen`)

A celebratory "Payment received" screen showing the amount received, the route, and the tx hash. It's **the same browser session re-labeled as the merchant** — there is no separate merchant login or identity.

### Session persistence

After a wallet is connected, `localStorage` key `seira.app.session.v1` stores `{ address, walletKind, screen, payment }`. On reload the app restores the screen and silently re-connects the wallet (`restoreProvider`) **without** popping the wallet modal. Status/merchant screens are not restorable (an in-flight promise can't be resurrected), so a refresh from them lands on the connected screen. Disconnect clears everything and returns to landing.

---

## 2. The request pipeline, in literal order

### 2a. `POST /api/plan` — `packages/api/src/server.ts:99`

1. `parsePaymentIntent(req.body)` validates: `intent === "payment"`, non-empty `payerAsset`/`receiverAsset`/`receiverAmount`/`recipient`, and a positive `receiverAmount`. Constraints (`maxFee`, `maxSlippage`, `deadline`, `priority`) are optional, validated, and default to `{}`.
2. `deps.planner.plan(intent, registry)` runs.

### 2b. The planner — `packages/planner/src/planner.ts`

What happens inside `plan()`:

1. **Build adjacency** — walks every registered asset pair and records which assets connect to which, and the capability entries for each edge.
2. **Enumerate paths** — DFS from `payerAsset` to `receiverAsset`, max 3 hops, no asset revisited. With the seed data the possible routes are: `FXRP→USDT0` (direct), `WFLR→FXRP` (direct), and `WFLR→FXRP→USDT0` (two-hop).
3. **Aggregate + score** — for each path, sums `cost`, `latencyMs`, multiplies `rate` and takes the min of `reliability`/`liquidityScore`. Then `scorePath()` computes a **lower-is-better** weighted score using presets (`DEFAULT_WEIGHTS` for no priority; `cost`/`speed`/`safety` presets).
4. **Feasibility filters** — rejects paths whose cost exceeds `maxFee`, whose latency would blow past `deadline`, or with any edge below `MIN_VIABLE_LIQUIDITY = 0.5`.
5. **Pick best** — sorts feasible paths ascending by score, takes the first, and emits the plan:
   - step 1: `AcquireAsset { asset: payerAsset }`
   - N × `ConvertAsset { from, to, preferredAdapter, fallbackAdapters, reversible }` (one per edge)
   - `Transfer { asset: receiverAsset, to: recipient }`
   - `VerifySettlement { asset: receiverAsset }`
   - `estimatedPayerAmount = receiverAmount / rate`, `estimatedCost = Σ cost`, `estimatedTime = Σ latencyMs`.

With seed values: FXRP→USDT0 direct has `latencyMs 2500`, `cost 0.003`, `rate 2.5`. WFLR→FXRP→USDT0 would be a 2-hop path.

**Important realism note:** The score uses the weights but with only one adapter per pair, every route's *choice* is basically predetermined by feasibility — the planner is over-engineered relative to the one-adapter registry, but the machinery is real and fully unit-tested.

### 2c. `GET /api/quote`

1. Validates `fromAsset`, `toAsset`, `amount`.
2. Looks up the first registered capability for the pair — if none, `400 no adapter serves pair`.
3. Calls `deps.runtime.quotePreview(...)` → the runtime resolves the token + adapter addresses and calls `TestSwapAdapter.quote(from, to, amountIn)` on-chain (a `view` call — no gas, no tx). Returns `amountOut` as a string.

This is why the "You pay" field updates live: it's reading the actual on-chain swap rate (which for FXRP→USDT0 is `amountIn × 2.5 / 1e18`).

---

## 3. Executing a payment — what literally happens

There are **two execution paths** chosen in `ConfirmScreen.handleConfirm`:

- **FXRP payer (default)** → **permit relay** (`executeViaPermitRelay`): one signature, backend pays gas.
- **WFLR payer** → **direct wallet-signed execution** (`executePlanWithWallet`): the browser signs and pays gas for every tx.

### Path A — Permit relay (FXRP payer), the "one-tap" flow

1. `Confirm & Send` → `executeViaPermitRelay(provider, plan, intent, walletAddress)`.
2. It requires `payerAsset === "FXRP"` (FXRP implements ERC-2612 permit). It computes the raw amount needed = `parseUnits(plan.estimatedPayerAmount, 18)`.
3. `fetch('/api/relayer')` → the backend returns the address of its own signer wallet (`createExecutionRuntime()`'s `Wallet` from `BACKEND_PRIVATE_KEY`). That becomes the permit's `spender`.
4. Reads the payer's current `nonces(address)` from the FXRP contract on-chain.
5. Builds the EIP-712 `Permit` message `{ owner, spender, value, nonce, deadline }` with domain `{ name: "FXRP", version: "1", chainId: 114, verifyingContract: FXRP }` and asks the wallet to **`signTypedData`** — this is the single prompt the user approves. **No gas is spent by the user.**
6. `POST /api/execute` with `{ plan, intent, permit }`.

The **backend** (`runtime.executeRelayed`, `runtime.ts:273`) then verifies and plays it out:

- Validates permit `spender` == backend relayer address, `token` == the plan's payer token, permit `value >= needed`.
- Checks the on-chain **nonce matches** the permit's nonce (prevents replay).
- Recovers the signer via `verifyTypedData` and requires it equal `permit.owner` — i.e., the offline signature is genuine.
- Submits `permit(owner, spender, value, deadline, v, r, s)` to the FXRP contract. This only sets an **allowance** for the relayer; no tokens move yet.
- Confirms the allowance then does `transferFrom(payer, relayer, needed)` — **this pulls the FXRP out of the payer's wallet via their signed permission** and credits it to the backend wallet (this is the gasless magic: the payer signed, the relayer pays gas).
- Finally calls `this.execute(plan)` with the **backend signer** as the executor.

### The shared execution engine — `runtime.execute`, `runtime.ts:175`

Regardless of path, `execute()` walks the steps in `stepId` order:

1. **AcquireAsset** — check the executor's FXRP balance ≥ `estimatedPayerAmount`; if not, business failure "insufficient balance". (For the relayed path the executor is the relayer, which just received the pulled funds.)
2. **ConvertAsset** — `convert()`:
   - Resolve token addresses + adapter address from config.
   - Call `adapter.quote()` (on-chain view). If `0`, fail with "quote returned zero output".
   - Check `allowance(executor, adapter)`; if too low, submit + wait for an `approve(adapter, MaxUint256)` tx.
   - Submit `swap(tokenIn, tokenOut, amountIn)` and `wait()` for the receipt.
   - Parse the actual output from the **`Swap` event** in the receipt's logs.
   - The resulting amount becomes the running amount for the next step.
3. **Transfer** — `receiverToken.transfer(recipient, runningAmount)` and wait for the receipt. **This is the moment the merchant receives their USDT0.**
4. **VerifySettlement** — read the recipient's USDT0 balance again; require the delta ≥ running amount minus a slippage tolerance (`estimatedSlippage` ppm, else 0). Fail if the recipient didn't actually get paid.

Result: a receipt `{ planId, status: "settled", steps[] }` where each step carries `{ status, txHash, actualAmount }`.

### Failure & rollback logic (`handleFailure`)

- If a step throws, the failing step gets a `failed` status.
- Any **completed reversible conversions** are rolled back **in reverse order**: for each, approve the *to*-token then `swap(to, from, amountOut)` back through the adapter (relayer/executor pays gas). Result status: **`rolled_back`**.
- Non-reversible failures → status `failed`.
- Unexpected (non-business) errors rethrow → 500.

### The latency self-correction (recently added)

Back in the API handler, on a `settled` receipt, `observeSettlementLatency()` records `Date.now()` elapsed and writes it back into the registry's per-edge `latencyMs` via `updateObserved` (evenly split across the plan's convert edges). So the *next* `/api/plan` call estimates time from the last real settlement. This only happens for `settled`, never `rollback`/`failed`.

### Path B — Direct wallet execution (WFLR payer)

`executePlanWithWallet()` mirrors the backend runtime but signs **each** transaction with the browser wallet:

- Determines `runningAmount = parseUnits(estimatedPayerAmount, 18)`.
- Acquire: checks the wallet's balance.
- Convert: `quote`, `approve` (if needed), `swap`, parse `Swap` event → running amount.
- Transfer: `transfer(recipient, runningAmount)`.
- Verify: checks recipient balance delta.

Every tx here prompts the wallet and spends the **payer's own C2FLR gas**. Because WFLR has no direct USDT0 pair in the registry, a WFLR→USDT0 plan is a **two-hop route** (`WFLR→FXRP→USDT0`), so this path literally executes two approve+swap pairs before transferring.

---

## 4. The contracts — `packages/contracts`

`TestSwapAdapter.sol` — a minimal fixed-rate market-maker, owner-deployed:

- `rates[tokenIn][tokenOut]` → fixed `rate` per pair (set by owner), output = `amountIn * rate / 1e18`.
- `liquidity[tokenOut]` → a pool balance; each `swap` decrements it for the output token and reverts if short ("insufficient liquidity").
- `swap()` does `transferFrom` the input token in, `transfer` the output out, emits `Swap`.
- `fundLiquidity()`, `setRate()` are owner-only.
- `quote()` = the same math as `swap` (it's a view with the `rate != 0` require).

Deployed on Coston2 (README table): `TestSwapAdapter 0x1A9e2805...47`, `FXRP 0x0b6A3645...dc7`, `USDT0 0xC1A5B415...71F`, `WFLR 0xaB6FaD89...d1F`. There are Hardhat deploy/setup scripts (`deploy.ts`, `setupDemo.ts`, `topUpLiquidity.ts`, `verifyQuote.ts`, `checkRate.ts`, `checkFtso.ts`).

---

## 5. The registry & oracle — `packages/registry`

- **`CapabilityRegistry`** — a plain in-memory array. `register()` adds entries; `getCapabilities(pair)` filters by asset pair; `updateObserved()` merges new rate/reliability/latency/liquidity into an existing entry (throws if the pair+adapter isn't registered). Every server restart re-seeds from `seed.ts` (four entries, both directions of FXRP↔USDT0 and FXRP↔WFLR, all via `TestSwapAdapter`).
- **FTSOv2 price feed** (`ftsoPriceFeed.ts`) — a standalone module (not wired into request paths yet) that:
  - Resolves the live FtsoV2 contract via `FlareContractRegistry` (`0xaD67FE...6019`).
  - Calls `getFeedsById` with XRP/USD and FLR/USD feed IDs.
  - Validates count, non-zero values/decimals, and **staleness (`MAX_FEED_AGE_SECONDS = 300`)**.
  - `refreshRegistryRates()` rewrites the seeded rates from live prices, treating USDT0 ≈ $1. This exists, is tested, but `/api/plan` does **not** call it — a roadmap item.

---

## 6. Deployment topology (dev vs production)

- **Local dev:** `npm run dev --workspace=packages/api` (Express on `:3000`) + `cd packages/frontend && npm run dev` (Vite on `:5173`), `vite.config.js` proxies `/api/*` → `http://localhost:3000` (overridable via `API_PROXY_TARGET`). The browser **never makes a cross-origin request**.
- **Vercel (live demo, seira-app.vercel.app):** the API is **bundled into the frontend deployment**. `scripts/bundle-api.mjs` esbuild-bundles `scripts/api-entry.ts` (just `createDefaultApp()`) into `packages/frontend/api/index.js`, and `vercel.json` rewrites `/api/:path*` to that serverless function. It needs `COSTON2_RPC_URL` + `BACKEND_PRIVATE_KEY` as env vars (dotenv loads `packages/api/.env`).

---

## 7. Non-technical summary of "what happens when I click"

1. **Start Payment** → the marketing page hands over to the payment flow.
2. **Connect wallet** → your browser (MetaMask/Rabby or a mobile wallet via WalletConnect) is asked to approve access and switch to Coston2 testnet; Seira reads your FXRP/WFLR balances to show.
3. **Fill the form** → you type what the merchant should receive (always USDT0) and how much; Seira quietly asks the swap contract on-chain "how much FXRP/WFLR does that need" and shows you the "You pay" figure. No money involved.
4. **Review** → Seira asks the backend to produce a plan; you see the route (via Seira Router), the estimated time, and the estimated cost. The plan has already been computed from the registry's route table.
5. **Confirm & Send (FXRP)** → your wallet asks you to sign **one** compact message (an ERC-2612 permit) authorizing Seira's backend to spend your FXRP. You aren't paying gas. The backend then submits the permit on-chain, pulls your FXRP, swaps it to USDT0 through the swap contract, transfers it to the merchant's address, and confirms the merchant's balance increased. The screen walks Acquire → Convert → Transfer → Verify in real time.
6. **Confirm & Send (WFLR)** → there's no permit, so your wallet prompts you through a chain of approvals and swaps (up to two swap hops, WFLR→FXRP→USDT0 — because there's no direct WFLR→USDT0 pool), and you pay gas for each.
7. **Done / View as Merchant** → a receipt showing the route and tx hash, or a merchant-view celebratory screen. If a mid-route swap had succeeded but the transfer failed, Seira swaps the funds *back* to FXRP so nothing is stranded (status `rolled_back`).
8. **Next time** → the plan's time estimate reflects the *last real* settlement duration, because the API fed the measured latency back into the registry.

---

## 8. Key caveats to be open about

- **It's a demo on a testnet** — no real money, no persistence of payments, no auth, one self-controlled "liquidity provider" contract instead of a real DEX.
- **`estimatedCost` is a registry metric** (e.g. `0.003`), not real gas — the UI labels it `FLR` but it isn't actual FLR gas cost.
- **Rates used for planning** are seed values (FXRP→USDT0 = 2.5) *unless* you run the FTSO refresh; the on-chain quote used for "You pay" is the contract's fixed rate, which may differ from the planner's rate.
- **"Safest route selected over 2 alternatives"** is aspirational UI — with the seed, there's effectively one adapter per pair.
- The relayer holds your FXRP momentarily (pulled from your wallet via permit, before converting/transferring out); on a testnet the same operator controls the backend signer.