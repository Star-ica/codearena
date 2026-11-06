/* Data layer — reads straight from the chain with ethers.js (no backend, no database).
   If no factory address is configured, serves static demo data so the UI can be previewed. */
(() => {
  const CFG = window.CODEARENA_CONFIG, ABIS = window.ABIS;
  const ZERO = "0x0000000000000000000000000000000000000000";
  const DEMO = !CFG.factory;
  const S = { browser: null, signer: null, account: null, cache: {} };
  const nowSec = () => Math.floor(Date.now() / 1000);

  // ───── helpers ─────
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "—");
  const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : /^ipfs:\/\//i.test(u) ? "https://ipfs.io/ipfs/" + u.slice(7) : "#");
  const tokenMeta = (addr) => CFG.tokens.find((t) => same(t.address, addr)) || { symbol: "TOKEN", decimals: 18, address: addr };
  const fmtAmt = (v, dec) => {
    const n = Number(ethers.formatUnits(v, dec));
    return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 2 });
  };
  const rel = (ts) => {
    const d = Number(ts) - nowSec(), a = Math.abs(d);
    const u = a >= 86400 ? [Math.floor(a / 86400), "d"] : a >= 3600 ? [Math.floor(a / 3600), "h"] : [Math.max(1, Math.floor(a / 60)), "m"];
    return d > 0 ? `in ${u[0]}${u[1]}` : `${u[0]}${u[1]} ago`;
  };
  const dt = (ts) => new Date(Number(ts) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const avatar = (addr) => {
    const h = ethers.id((addr || "0x").toLowerCase());
    const a = parseInt(h.slice(2, 6), 16) % 360, b = (a + 40 + (parseInt(h.slice(6, 8), 16) % 120)) % 360;
    return `background:linear-gradient(135deg,hsl(${a} 70% 55%),hsl(${b} 70% 40%))`;
  };

  // ───── ranking (mirrors Challenge._better exactly) ─────
  const better = (A, B) => {
    const l = BigInt(A.scoreSum) * BigInt(B.judgeCount), r = BigInt(B.scoreSum) * BigInt(A.judgeCount);
    if (l !== r) return l > r;
    if (A.submittedAt !== B.submittedAt) return A.submittedAt < B.submittedAt;
    return A.id < B.id;
  };
  const eligible = (c, s) => !s.disqualified && s.judgeCount >= c.minJudgeScores;
  const avg = (s) => (s.judgeCount ? s.scoreSum / s.judgeCount : null);
  function rankAll(c, subs) {
    const el = subs.filter((s) => eligible(c, s)).sort((a, b) => (better(a, b) ? -1 : 1));
    const rest = subs.filter((s) => !eligible(c, s)).sort((a, b) => (avg(b) ?? -1) - (avg(a) ?? -1));
    return [...el.map((s, i) => ({ ...s, rank: i, eligible: true })), ...rest.map((s) => ({ ...s, rank: null, eligible: false }))];
  }
  const winnerIds = (c, subs) => rankAll(c, subs).filter((s) => s.eligible).slice(0, c.prizes.length).map((s) => s.id);

  function subStatus(c, s, winners) {
    if (s.disqualified) return ["Disqualified", "bad"];
    const wi = winners.indexOf(s.id);
    if (wi >= 0 && c.phase >= 4) return [`Winner #${wi + 1}`, "ok"];
    if (c.phase === 1) return ["Submitted", ""];
    if (s.judgeCount === 0) return ["Awaiting review", ""];
    if (s.judgeCount < c.minJudgeScores) return ["In review", "p2"];
    return c.phase >= 4 ? ["Scored", "p5"] : ["Scored", "p5"];
  }

  // ───── providers / contracts ─────
  const reader = () => {
    if (!S.reader) S.reader = S.browser || new ethers.JsonRpcProvider(CFG.rpcUrl);
    return S.reader;
  };
  const ch = (addr, signer) => new ethers.Contract(addr, ABIS.challenge, signer ? S.signer : reader());
  const factory = (signer) => new ethers.Contract(CFG.factory, ABIS.factory, signer ? S.signer : reader());
  const registry = (signer) => new ethers.Contract(CFG.registry, ABIS.registry, signer ? S.signer : reader());

  // ───── demo data ─────
  const DAY = 86400;
  const DEV = (n) => ethers.getAddress("0x" + ethers.id("dev" + n).slice(26));
  const mkDemo = () => {
    const t = nowSec();
    const O = [["Nimbus Labs", DEV("o1")], ["Aurora Protocol", DEV("o2")], ["Helix Foundation", DEV("o3")]];
    const mk = (i, o, title, desc, diff, phase, dl, prizes, tok, subs, wins) => ({
      addr: ethers.getAddress("0x" + ethers.id("ch" + i).slice(26)), organizer: O[o][1], orgName: O[o][0], arbiter: DEV("arb"),
      token: tok.address, symbol: tok.symbol, decimals: tok.decimals, title, description: desc,
      requirements: "• Public GitHub repository with README\n• Tests must pass in CI\n• MIT or Apache-2.0 licence\n• Submit commit hash of the final release",
      difficulty: diff, deadline: t + dl * DAY, judgingEnd: t + (dl + 7) * DAY, disputeEnd: t + (dl + 10) * DAY, disputeWindow: 3 * DAY,
      minJudgeScores: 2, maxSubmissionsPerDev: 1, prizes: prizes.map((p) => ethers.parseUnits(String(p), tok.decimals)),
      totalPrize: ethers.parseUnits(String(prizes.reduce((a, b) => a + b, 0)), tok.decimals), phase,
      submissionCount: subs, participantCount: subs + 6, eligibleCount: wins ? subs : 0, openDisputes: 0, funded: phase > 0, needsReRank: false,
    });
    const U = { symbol: "USDT", decimals: 6, address: "0xUSDT" }, B = { symbol: "BOT", decimals: 18, address: "0xBOT" };
    const list = [
      mk(1, 0, "ZK Merkle Proof Verifier in Solidity", "Implement a gas-optimised verifier for Groth16 Merkle membership proofs. Must beat the reference implementation by 20% gas on the benchmark suite.", 4, 1, 12, [4000, 2000, 1000], U, 7, 0),
      mk(2, 1, "Intent-Based Swap Router", "Build a routing engine that splits orders across 3+ DEXs and settles via signed intents. Provide a Foundry test-suite and a short design doc.", 3, 1, 20, [2500, 1500], U, 4, 0),
      mk(3, 2, "Wallet Activity Dashboard", "Vanilla JS dashboard that decodes ERC-20 transfers for any address using only a public RPC. Accessibility and performance count.", 2, 1, 6, [800, 400, 200], B, 12, 0),
      mk(4, 0, "Beginner: ERC-721 Minting dApp", "Create a minimal minting page with allow-list support using ethers.js. Great first onchain project.", 1, 1, 28, [300, 150], U, 21, 0),
      mk(5, 1, "Fuzzing Harness for Lending Markets", "Write invariant tests that uncover seeded bugs in a lending protocol fork. Score by bugs found and report quality.", 4, 2, -3, [6000, 3000], U, 9, 0),
      mk(6, 2, "Gas Golf: Sorting on EVM", "Sort 256 uint256 values with the lowest gas. Judges verify against the public benchmark.", 3, 5, -20, [1200, 600, 300], B, 15, 3),
    ];
    list[4].judgingEnd = t + 4 * DAY; list[4].disputeEnd = 0;
    list[5].judgingEnd = t - 13 * DAY; list[5].disputeEnd = t - 10 * DAY;
    const names = ["ethsmith", "0xnova", "gaslord", "solwitch", "yulmaster", "bytecode", "defi_dan", "audit_ana"];
    const detail = {};
    for (const c of list) {
      const subs = Array.from({ length: Math.min(c.submissionCount, 9) }, (_, i) => {
        const jc = c.phase >= 2 ? 2 : 0;
        const sc = c.phase >= 2 ? 55 + ((i * 17 + c.difficulty * 7) % 45) : 0;
        return {
          id: i, dev: DEV(names[i % names.length] + c.title.length), submittedAt: t - (i + 3) * 3600 * 9, disqualified: false,
          judgeCount: jc, scoreSum: sc * jc, contentHash: ethers.id("h" + i + c.title), uri: `https://github.com/${names[i % names.length]}/${c.title.toLowerCase().replace(/[^a-z]+/g, "-").slice(0, 24)}`,
        };
      });
      const winners = c.phase >= 4 || c.phase === 5 ? winnerIds({ ...c, minJudgeScores: 2, prizes: c.prizes }, subs) : [];
      if (c.phase === 5) subs.forEach((s) => { s.judgeCount = 2; });
      detail[c.addr] = {
        subs, winners, judges: [DEV("j1"), DEV("j2"), DEV("j3")], disputes: [],
        events: [{ name: "Funded", block: 100, text: `Organizer funded ${fmtAmt(c.totalPrize, c.decimals)} ${c.symbol}` }, ...subs.slice(0, 3).map((s, i) => ({ name: "Submitted", block: 110 + i, text: `Submission #${s.id} by ${short(s.dev)}` })), ...(c.phase >= 2 ? [{ name: "ReviewSubmitted", block: 130, text: "Judge " + short(DEV("j1")) + " scored submission #0" }] : [])],
      };
    }
    return { list, detail };
  };
  const demo = DEMO ? mkDemo() : null;

  // ───── loaders ─────
  async function orgName(addr) {
    S.cache.org ??= {};
    if (S.cache.org[addr.toLowerCase()]) return S.cache.org[addr.toLowerCase()];
    let n = short(addr);
    try { const p = await registry().getProfile(addr); if (p.exists) n = p.name; } catch {}
    return (S.cache.org[addr.toLowerCase()] = n);
  }
  async function loadChallenge(addr) {
    const i = await ch(addr).info();
    const m = tokenMeta(i.token);
    return {
      addr, organizer: i.organizer, orgName: await orgName(i.organizer), arbiter: i.arbiter, token: i.token, symbol: m.symbol, decimals: m.decimals,
      title: i.title, description: i.description, requirements: i.requirements, difficulty: Number(i.difficulty),
      deadline: Number(i.deadline), judgingEnd: Number(i.judgingEnd), disputeEnd: Number(i.disputeEnd), disputeWindow: Number(i.disputeWindow),
      minJudgeScores: Number(i.minJudgeScores), maxSubmissionsPerDev: Number(i.maxSubmissionsPerDev), totalPrize: i.totalPrize, prizes: [...i.prizes],
      phase: Number(i.phase), submissionCount: Number(i.submissionCount), participantCount: Number(i.participantCount),
      eligibleCount: Number(i.eligibleCount), openDisputes: Number(i.openDisputes), funded: i.funded, needsReRank: i.needsReRank,
    };
  }
  async function loadAll() {
    if (DEMO) return demo.list;
    const addrs = [...(await factory().allChallenges())].reverse();
    return Promise.all(addrs.map(loadChallenge));
  }
  async function loadByOrganizer(acct) {
    if (DEMO) return demo.list.filter((c) => same(c.organizer, acct));
    const addrs = [...(await factory().challengesByOrganizer(acct))].reverse();
    return Promise.all(addrs.map(loadChallenge));
  }
  async function loadSubs(addr, count) {
    const c = ch(addr);
    const raw = await Promise.all(Array.from({ length: count }, (_, i) => c.getSubmission(i)));
    return raw.map((s, id) => ({ id, dev: s.dev, submittedAt: Number(s.submittedAt), disqualified: s.disqualified, judgeCount: Number(s.judgeCount), scoreSum: Number(s.scoreSum), contentHash: s.contentHash, uri: s.uri }));
  }
  async function loadDetail(c) {
    if (DEMO) return demo.detail[c.addr] || { subs: [], winners: [], judges: [], disputes: [], events: [] };
    const k = ch(c.addr);
    const [subs, judges, winners, dc] = await Promise.all([loadSubs(c.addr, c.submissionCount), k.judges(), k.winners(), k.disputeCount()]);
    const disputes = await Promise.all(Array.from({ length: Number(dc) }, async (_, i) => {
      const d = await k.getDispute(i);
      return { id: i, raiser: d.raiser, submissionId: Number(d.submissionId), status: Number(d.status), createdAt: Number(d.createdAt), evidenceURI: d.evidenceURI };
    }));
    return { subs, judges: [...judges], winners: [...winners].map(Number), disputes, events: [] };
  }
  const EVENT_TEXT = {
    Funded: (a) => `Organizer escrowed the prize pool`,
    Cancelled: () => `Competition cancelled and refunded`,
    Joined: (a) => `${short(a.dev)} joined`,
    Submitted: (a) => `Submission #${a.id} by ${short(a.dev)}`,
    JudgeAdded: (a) => `Judge ${short(a.judge)} authorized`,
    JudgeRemoved: (a) => `Judge ${short(a.judge)} removed`,
    ReviewSubmitted: (a) => `Judge ${short(a.judge)} ${a.revised ? "revised" : "gave"} score ${a.score} on #${a.id}`,
    Disqualified: (a) => `Submission #${a.id} disqualified`,
    ScoreAdjusted: (a) => `Arbiter set #${a.id} score to ${a.newScore}`,
    WinnersFinalized: (a) => `${a.rerank ? "Winners re-ranked" : "Winners approved"} by ${short(a.by)}`,
    DisputeRaised: (a) => `Dispute #${a.disputeId} on #${a.id} by ${short(a.raiser)}`,
    DisputeResolved: (a) => `Dispute #${a.disputeId} resolved (${["", "open", "rejected", "upheld", "expired"][Number(a.status)]})`,
    PrizeClaimed: (a) => `Rank ${Number(a.rank) + 1} prize claimed by ${short(a.dev)}`,
    RemainderWithdrawn: () => `Unawarded remainder returned to organizer`,
  };
  async function loadEvents(c) {
    if (DEMO) return demo.detail[c.addr]?.events || [];
    const k = ch(c.addr), out = [];
    await Promise.all(Object.keys(EVENT_TEXT).map(async (name) => {
      try { for (const l of await k.queryFilter(name)) out.push({ name, block: l.blockNumber, idx: l.index, tx: l.transactionHash, text: EVENT_TEXT[name](l.args) }); } catch {}
    }));
    return out.sort((a, b) => a.block - b.block || a.idx - b.idx);
  }
  async function loadProfile(addr) {
    if (DEMO) return { name: "Demo Organization", website: "https://example.org", description: "Sample organizer profile (demo mode).", verified: true, exists: true };
    const p = await registry().getProfile(addr);
    return { name: p.name, website: p.website, description: p.description, verified: p.verified, exists: p.exists, registeredAt: Number(p.registeredAt) };
  }

  window.DATA = { CFG, DEMO, S, ZERO, nowSec, esc, short, same, safeUrl, tokenMeta, fmtAmt, rel, dt, avatar, better, eligible, avg, rankAll, winnerIds, subStatus, reader, ch, factory, registry, loadAll, loadByOrganizer, loadChallenge, loadDetail, loadEvents, loadProfile };
})();
