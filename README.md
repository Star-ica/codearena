# CodeArena — Onchain Developer Competition Platform (MVP)

Organizations publish coding challenges and escrow prizes (native currency, BOT or USDT). Developers join and submit
GitHub references + content hashes. Authorized judges score. The contract **verifies** the winner ranking against the
recorded scores, runs a dispute window, then lets winners pull their prizes. No backend, no database.

Stack: HTML5 · CSS3 · Vanilla JS · Solidity 0.8.24 · ethers.js v6 (Hardhat + OpenZeppelin for build/test only).

```
contracts/   OrganizerRegistry, ChallengeFactory, Challenge (escrow+submissions+judging+disputes+claims), MockToken
test/        Hardhat tests (escrow, submissions, judging, ranking verification, disputes, claims, refunds)
scripts/     deploy.js (also writes frontend/js/config.js)
frontend/    index.html, css/style.css, js/{config,abi,data,app}.js
docs/        CodeArena_Whitepaper.pdf (+ build_whitepaper.py)
```

## 1. Install & test
```bash
npm install
npx hardhat compile
npx hardhat test
```
> Note: the contracts and tests were written without a compiler available in the authoring environment, so run the
> compile/test step first and fix any toolchain-specific issue before deploying.

## 2. Run locally (end-to-end)
```bash
npx hardhat node                      # terminal 1 (chain id 31337)
DEPLOY_MOCKS=true NATIVE_SYMBOL=ETH npx hardhat run scripts/deploy.js --network localhost   # terminal 2
npm run serve                         # serves ./frontend on http://localhost:8080
```
`deploy.js` deploys the registry, factory (arbiter = deployer unless `ARBITER_ADDRESS` is set), optional mock BOT/USDT, allow-lists
the tokens and **writes `frontend/js/config.js`**. Import a Hardhat test account into MetaMask (network `http://127.0.0.1:8545`, chain 31337).
Mint mock tokens from the console: `MockToken.mint(yourAddress, amount)`.

Without a configured `factory` address the UI runs in **demo mode** (sample data, read-only) — open `frontend/index.html` through any static server.

## 3. Deploy to a real network (BOT chain / testnet)
```bash
cp .env.example .env     # set RPC_URL, CHAIN_ID, DEPLOYER_KEY, ARBITER_ADDRESS (multisig!), BOT_TOKEN_ADDRESS, USDT_TOKEN_ADDRESS
npx hardhat run scripts/deploy.js --network target
```
- Use a **testnet first**. The MVP is unaudited.
- If BOT is the chain's native coin, leave `BOT_TOKEN_ADDRESS` empty and set `NATIVE_SYMBOL=BOT`.
- Host `frontend/` on any static host (IPFS, GitHub Pages, S3, Netlify). It only needs `js/config.js` to point at your deployment.
- Verify contracts on the explorer using the flattened sources or the Hardhat verify plugin.

## 4. Using the app
1. **Organizer**: Create → register organization → publish challenge (prizes, deadline, judging period, dispute window, quorum) → open it → **Fund** (ERC-20 asks for an approval first) → add judges *before the deadline*.
2. **Developer**: Explore → Join → Submit (repo URL + commit; content hash computed locally) → track status on your dashboard.
3. **Judge**: Judge dashboard → score 0–100 during the judging window (revisions are logged).
4. **Organizer**: after judging ends → *Approve winners* (frontend computes the ranking; contract verifies it).
5. **Anyone in the competition**: raise disputes during the window; **arbiter** resolves them (a re-rank follows if scores changed).
6. **Winners** claim; organizer withdraws any unawarded remainder.

## Key contract rules
- One entry per developer by default; content hash unique per challenge; join before submit; submissions close at the deadline.
- Judge list frozen at the deadline; judges/organizer/arbiter cannot participate.
- Winners = top `min(#prizes, #eligible)` by average score → earlier submission → lower id; any other list reverts.
- Organizer can't cancel once a submission exists; absent organizers can be bypassed after 7 days; stale disputes expire after 14 days.
- Prize claims are pull-based, once per rank, only by the winning author.

See `docs/CodeArena_Whitepaper.pdf` for the full model, threat analysis and known limitations.
# codearena
