/* CodeArena UI — hash-routed single page app. Vanilla JS + ethers.js only. */
(() => {
  const D = window.DATA;
  const { CFG, DEMO, S, ZERO, esc, short, same, safeUrl, fmtAmt, rel, dt, avatar, rankAll, winnerIds, subStatus, avg } = D;
  const { PHASES, DIFFICULTY, ABIS } = window;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = (h) => { $("#view").innerHTML = h; window.scrollTo(0, 0); };
  const loading = () => view('<div class="loading">fetching from chain</div>');
  const GRACE = 7 * 86400;

  // ───────────── UI primitives ─────────────
  function toast(msg, err) {
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), err ? 7000 : 3800);
  }
  const errMsg = (e) => e?.reason || e?.shortMessage || e?.info?.error?.message || e?.message || "Transaction failed";
  const devChip = (a) => `<a class="dev" href="#/developer/${a}"><i class="av" style="${avatar(a)}"></i>${short(a)}</a>`;
  const diffEl = (d) => `<span class="diff l${d}"><span class="bars"><i></i><i></i><i></i><i></i></span>${DIFFICULTY[d]}</span>`;
  const phaseBadge = (p) => `<span class="badge p${p}">${PHASES[p]}</span>`;
  const prizeStr = (c) => `${fmtAmt(c.totalPrize, c.decimals)} <small>${esc(c.symbol)}</small>`;
  const timeLabel = (c) => c.phase <= 1 ? `closes ${rel(c.deadline)}` : c.phase === 2 ? `judging ends ${rel(c.judgingEnd)}` : `closed ${rel(c.deadline)}`;
  const card = (c) => `
    <a class="card hover" href="#/challenge/${c.addr}">
      <div class="ch-top">${diffEl(c.difficulty)}${phaseBadge(c.phase)}</div>
      <div class="ch-title">${esc(c.title)}</div>
      <div class="ch-org">by ${esc(c.orgName)}</div>
      <div class="prize">${prizeStr(c)}</div>
      <div class="meta"><span><b>${c.submissionCount}</b> submissions</span><span><b>${c.prizes.length}</b> winners</span><span>${timeLabel(c)}</span></div>
    </a>`;
  const empty = (msg, cta = "") => `<div class="empty">${msg}${cta ? `<div class="actions" style="justify-content:center">${cta}</div>` : ""}</div>`;
  const kv = (k, v) => `<div class="kv"><span>${k}</span><span>${v}</span></div>`;
  const needWallet = () => `<div class="alert warn">Connect a wallet to continue. <button class="btn sm" data-act="connect" style="margin-left:8px">Connect wallet</button></div>`;
  const getC = async (a) => (DEMO ? (await D.loadAll()).find((x) => same(x.addr, a)) : D.loadChallenge(a));

  // ───────────── wallet ─────────────
  async function ensureChain() {
    const net = await S.browser.getNetwork();
    if (Number(net.chainId) === CFG.chainId) return;
    const hex = "0x" + CFG.chainId.toString(16);
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
    catch (e) {
      if (e.code !== 4902) throw e;
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: CFG.chainName, rpcUrls: [CFG.rpcUrl], nativeCurrency: { name: CFG.tokens[0].symbol, symbol: CFG.tokens[0].symbol, decimals: 18 }, blockExplorerUrls: CFG.explorer ? [CFG.explorer] : [] }] });
    }
    S.browser = new ethers.BrowserProvider(window.ethereum);
  }
  async function connect() {
    if (!window.ethereum) return toast("No wallet detected. Install MetaMask or another EIP-1193 wallet.", true);
    try {
      S.browser = new ethers.BrowserProvider(window.ethereum);
      await S.browser.send("eth_requestAccounts", []);
      if (!DEMO) await ensureChain();
      S.reader = null;
      S.signer = await S.browser.getSigner();
      S.account = await S.signer.getAddress();
      header(); route();
    } catch (e) { toast(errMsg(e), true); }
  }
  function header() {
    const r = (location.hash.match(/^#\/(\w+)/) || [])[1] || "";
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.r === r));
    $("#net").textContent = DEMO ? "DEMO MODE" : CFG.chainName;
    $("#net").className = "net" + (DEMO ? " demo" : "");
    $("#connect").textContent = S.account ? short(S.account) : "Connect wallet";
  }
  /** Run a transaction with wallet check, toasts and refresh. */
  async function run(label, fn) {
    if (DEMO) return toast("Demo mode: deploy the contracts and set their addresses in js/config.js to transact.", true);
    if (!S.signer) { await connect(); if (!S.signer) return; }
    try {
      toast(label + "… confirm in wallet");
      const tx = await fn();
      const rc = await tx.wait();
      toast(label + " ✓ confirmed");
      route();
      return rc;
    } catch (e) { toast(errMsg(e), true); }
  }

  // ───────────── pages ─────────────
  async function landing() {
    loading();
    const list = await D.loadAll();
    const totals = {};
    list.forEach((c) => { totals[c.symbol] = (totals[c.symbol] || 0n) + c.totalPrize; });
    const dec = {}; list.forEach((c) => { dec[c.symbol] = c.decimals; });
    const poolTxt = Object.entries(totals).map(([s, v]) => `${fmtAmt(v, dec[s])} ${s}`).join(" + ") || "0";
    const devs = list.reduce((a, c) => a + c.participantCount, 0);
    const open = list.filter((c) => c.phase === 1).slice(0, 3);
    view(`
      <section class="hero">
        <div>
          <div class="prompt">codearena --compete</div>
          <h1>Ship code.<br>Get judged.<br><em>Get paid onchain.</em></h1>
          <p class="lead">Organizations escrow prize pools in smart contracts. Developers submit repositories. Authorized judges score. The contract verifies the ranking and releases the prizes — no middlemen.</p>
          <div class="actions"><a class="btn primary" href="#/explore">Browse competitions →</a><a class="btn" href="#/create">Publish a challenge</a></div>
        </div>
        <div class="term"><div class="bar"><i></i><i></i><i></i></div><pre><span class="d"># lifecycle of a challenge</span>
<span class="g">organizer</span>.createChallenge(prizes, deadline)
<span class="g">organizer</span>.fund()            <span class="d">// prizes locked in escrow</span>
<span class="b">developer</span>.join()
<span class="b">developer</span>.submit(repoURI, hash) <span class="d">// unique hash</span>
<span class="a">judge</span>.score(id, 0..100, notesHash)
<span class="g">organizer</span>.finalize([ids])    <span class="d">// contract verifies order</span>
<span class="b">developer</span>.raiseDispute(id, evidence)
<span class="b">winner</span>.claimPrize(rank)       <span class="d">// pull payment</span></pre></div>
      </section>
      <section class="stats">
        <div class="stat"><b>${list.length}</b><span>competitions</span></div>
        <div class="stat"><b>${esc(poolTxt)}</b><span>total prize pools</span></div>
        <div class="stat"><b>${devs}</b><span>developer entries</span></div>
        <div class="stat"><b>${list.filter((c) => c.phase === 1).length}</b><span>open right now</span></div>
      </section>
      <div class="page-title"><h2>Open challenges</h2></div>
      ${open.length ? `<div class="grid">${open.map(card).join("")}</div>` : empty("No open challenges yet.", `<a class="btn primary" href="#/create">Publish the first one</a>`)}
      <div class="sep"></div>
      <div class="page-title"><h2>How it works</h2></div>
      <div class="grid3 steps">
        <div class="step"><h3>Organizers fund</h3><p>Register an organization, define prizes per rank, pick BOT or USDT and lock the pool. Funds can only go to verified winners or back to you.</p></div>
        <div class="step"><h3>Developers submit</h3><p>Join, then submit a GitHub link plus a content hash. Duplicate work cannot be entered twice.</p></div>
        <div class="step"><h3>Judges score</h3><p>Judges are fixed before the deadline. Every score and revision is logged on-chain as an auditable history.</p></div>
        <div class="step"><h3>Contract verifies</h3><p>Anyone can compute the ranking; the contract rejects any order that doesn't match recorded scores.</p></div>
        <div class="step"><h3>Disputes</h3><p>Participants can challenge results during a window. An independent arbiter can adjust scores or disqualify plagiarism.</p></div>
        <div class="step"><h3>Claim &amp; refund</h3><p>Winners pull prizes once. Unawarded or cancelled pools return to the organizer.</p></div>
      </div>
      <div class="sep"></div>
      <div class="page-title"><h2>What the blockchain does — and doesn't</h2></div>
      <div class="trust">
        <div class="card yes"><h3>On-chain, enforced</h3><ul><li>Escrow of the exact prize pool</li><li>Submission references, hashes and timestamps</li><li>Judge authorization and one-score-per-judge accounting</li><li>Ranking verification &amp; deterministic tie-breaks</li><li>Dispute window, arbitration and prize claims</li></ul></div>
        <div class="card no"><h3>Not on-chain</h3><ul><li>Running or benchmarking submitted code</li><li>Reading GitHub repositories</li><li>Deciding whether work is <i>good</i> — that is the judges' job, made transparent</li></ul></div>
      </div>`);
  }

  async function explore() {
    loading();
    const list = await D.loadAll();
    view(`
      <div class="page-title"><div class="prompt">codearena explore</div><h1>Competitions</h1><p>${list.length} challenges across all difficulty levels.</p></div>
      <div class="filters">
        <input id="f-q" placeholder="Search title, organization…">
        <select id="f-d"><option value="">Any difficulty</option>${[1, 2, 3, 4].map((d) => `<option value="${d}">${DIFFICULTY[d]}</option>`).join("")}</select>
        <select id="f-p"><option value="">Any status</option>${PHASES.map((p, i) => `<option value="${i}">${p}</option>`).join("")}</select>
        <select id="f-s"><option value="new">Newest</option><option value="prize">Largest prize</option><option value="end">Ending soon</option></select>
      </div>
      <div id="grid" class="grid"></div>`);
    const draw = () => {
      const q = $("#f-q").value.toLowerCase(), d = $("#f-d").value, p = $("#f-p").value, s = $("#f-s").value;
      let r = list.filter((c) => (!q || (c.title + c.orgName).toLowerCase().includes(q)) && (!d || c.difficulty == d) && (p === "" || c.phase == p));
      if (s === "prize") r = [...r].sort((a, b) => Number(b.totalPrize / 10n ** BigInt(b.decimals)) - Number(a.totalPrize / 10n ** BigInt(a.decimals)));
      if (s === "end") r = [...r].sort((a, b) => a.deadline - b.deadline);
      $("#grid").innerHTML = r.length ? r.map(card).join("") : `<div style="grid-column:1/-1">${empty("No competitions match your filters.")}</div>`;
    };
    $$(".filters input,.filters select").forEach((e) => e.addEventListener("input", draw));
    draw();
  }

  async function challengePage(addr) {
    loading();
    const c = await getC(addr);
    if (!c) return view(empty("Challenge not found."));
    const [det, events] = await Promise.all([D.loadDetail(c), D.loadEvents(c)]);
    const me = S.account;
    const isOrg = same(me, c.organizer), isArb = same(me, c.arbiter);
    const isJudge = det.judges.some((j) => same(j, me));
    const isPart = DEMO || !me ? false : await D.ch(c.addr).isParticipant(me);
    const ranked = rankAll(c, det.subs);
    const winners = det.winners;
    const claimed = !DEMO && winners.length ? await Promise.all(winners.map((_, i) => D.ch(c.addr).prizeClaimed(i))) : [];
    const remainderDone = !DEMO && c.phase === 5 ? await D.ch(c.addr).remainderWithdrawn() : false;
    const awarded = winners.reduce((a, _, i) => a + c.prizes[i], 0n);
    const preview = winnerIds(c, det.subs);
    const nowS = D.nowSec();
    const canFinalize = c.phase === 3 || (c.phase === 4 && c.needsReRank);
    const medal = ["r0", "r1", "r2"];

    const actions = [];
    if (c.phase === 0 && isOrg) actions.push(`<button class="btn primary" data-act="fund" data-addr="${c.addr}">Fund ${prizeStr(c).replace(/<[^>]+>/g, "")}</button>`);
    if (c.phase === 0) actions.push(`<div class="hint">Not funded yet. Joining and submissions open once the organizer escrows the full prize pool.</div>`);
    if (c.phase === 1 && !isOrg && !isJudge && !isArb) actions.push(isPart ? `<a class="btn primary" href="#/submit/${c.addr}">Submit your work</a>` : `<button class="btn primary" data-act="join" data-addr="${c.addr}">Join challenge</button>`);
    if ((c.phase <= 1) && isOrg && c.submissionCount === 0 && !c.cancelledFlag) actions.push(`<button class="btn danger" data-act="cancel" data-addr="${c.addr}">Cancel &amp; refund</button>`);
    if (c.phase === 2 && isJudge) actions.push(`<a class="btn primary" href="#/judge">Open judge dashboard</a>`);
    if (canFinalize && (isOrg || nowS > c.judgingEnd + GRACE)) actions.push(`<button class="btn primary" data-act="finalize" data-addr="${c.addr}">${c.needsReRank ? "Re-rank winners" : "Approve winners"} (${preview.length})</button><div class="hint">Ranking is computed from recorded scores. The contract reverts if it doesn't match.</div>`);
    if (c.phase === 5 && isOrg && !remainderDone && c.totalPrize > awarded) actions.push(`<button class="btn" data-act="withdraw" data-addr="${c.addr}">Withdraw unawarded ${fmtAmt(c.totalPrize - awarded, c.decimals)} ${esc(c.symbol)}</button>`);
    winners.forEach((sid, i) => {
      const s = det.subs.find((x) => x.id === sid);
      if (s && same(s.dev, me) && c.phase === 5) actions.push(claimed[i] ? `<span class="badge ok">Rank ${i + 1} prize claimed</span>` : `<button class="btn primary" data-act="claim" data-addr="${c.addr}" data-rank="${i}">Claim rank ${i + 1}: ${fmtAmt(c.prizes[i], c.decimals)} ${esc(c.symbol)}</button>`);
    });

    const rows = ranked.map((s) => {
      const [st, cls] = subStatus(c, s, winners);
      const a = avg(s);
      return `<tr><td class="rank ${s.rank !== null ? medal[s.rank] || "" : ""}">${s.rank !== null ? "#" + (s.rank + 1) : "—"}</td>
        <td>${devChip(s.dev)}</td>
        <td><a class="link mono" style="font-size:12.5px" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(s.uri))}">${esc(s.uri.replace(/^https?:\/\//, "").slice(0, 38))}</a><div class="hint mono" style="margin:0">${s.contentHash.slice(0, 10)}…</div></td>
        <td>${s.judgeCount}/${c.minJudgeScores}+</td>
        <td style="min-width:120px">${a === null ? '<span class="hint">—</span>' : `<b class="mono">${a.toFixed(1)}</b><div class="scorebar"><i style="width:${a}%"></i></div>`}</td>
        <td><span class="badge ${cls}">${st}</span></td></tr>`;
    }).join("");

    const disputeRows = det.disputes.map((d) => {
      const st = ["", "Open", "Rejected", "Upheld", "Expired"][d.status];
      const arb = isArb && d.status === 1 ? `<div class="actions" style="margin-top:8px">
        <button class="btn sm" data-act="resolve" data-addr="${c.addr}" data-id="${d.id}" data-mode="reject">Reject</button>
        <input id="ns-${d.id}" type="number" min="0" max="100" placeholder="new score" style="width:110px;padding:5px 8px">
        <button class="btn sm" data-act="resolve" data-addr="${c.addr}" data-id="${d.id}" data-mode="score">Uphold: set score</button>
        <button class="btn sm danger" data-act="resolve" data-addr="${c.addr}" data-id="${d.id}" data-mode="dq">Uphold: disqualify</button></div>` : "";
      const exp = d.status === 1 && !DEMO && nowS >= c.disputeEnd + 14 * 86400 ? `<button class="btn sm" data-act="expire" data-addr="${c.addr}" data-id="${d.id}">Expire (arbiter timeout)</button>` : "";
      return `<li><b>#${d.id}</b> on submission #${d.submissionId} by ${devChip(d.raiser)} <span class="badge ${d.status === 3 ? "ok" : ""}">${st}</span>
        <small><a class="link" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(d.evidenceURI))}">${esc(d.evidenceURI.slice(0, 50))}</a> · ${dt(d.createdAt)}</small>${arb}${exp}</li>`;
    }).join("");
    const canDispute = isPart && c.phase === 4 && nowS < c.disputeEnd;

    view(`
      <div class="page-title">
        <div class="ch-top" style="justify-content:flex-start;gap:14px">${diffEl(c.difficulty)}${phaseBadge(c.phase)}${c.needsReRank ? '<span class="badge p3">Re-rank pending</span>' : ""}</div>
        <h1>${esc(c.title)}</h1>
        <p>by <a class="link" href="#/organizer/${c.organizer}">${esc(c.orgName)}</a> · <span class="mono" style="font-size:13px">${short(c.addr)}</span></p>
      </div>
      ${DEMO ? '<div class="alert warn">Demo mode — sample data. Deploy contracts and set addresses in <code>js/config.js</code> to go live.</div>' : ""}
      <div class="split">
        <div>
          <div class="card"><h3>Description</h3><div class="sep" style="margin:12px 0"></div><div class="prose">${esc(c.description) || "—"}</div></div>
          <div class="card" style="margin-top:18px"><h3>Submission requirements</h3><div class="sep" style="margin:12px 0"></div><div class="prose">${esc(c.requirements) || "—"}</div></div>

          <div class="card" style="margin-top:18px"><h3>Leaderboard ${c.phase < 4 ? '<span class="hint">(provisional)</span>' : ""}</h3>
            <div class="scroll" style="margin-top:8px">${ranked.length ? `<table class="tbl"><thead><tr><th>Rank</th><th>Developer</th><th>Submission</th><th>Reviews</th><th>Avg score</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>` : empty("No submissions yet.")}</div>
            <div class="hint">Ranking: higher average score → earlier submission → lower id. Only entries with ≥ ${c.minJudgeScores} judge scores are eligible.</div>
          </div>

          <div class="card" style="margin-top:18px"><h3>Disputes</h3>
            ${disputeRows ? `<ul class="timeline" style="margin-top:14px">${disputeRows}</ul>` : '<p class="hint" style="margin-top:8px">No disputes raised.</p>'}
            ${canDispute ? `<div class="sep"></div><h3>Raise a dispute</h3>
              <div class="row"><div><label>Submission #</label><input id="dp-id" type="number" min="0" value="0"></div>
              <div style="flex:3"><label>Evidence URL (https:// or ipfs://)</label><input id="dp-ev" placeholder="https://gist.github.com/…"></div></div>
              <div class="actions"><button class="btn" data-act="dispute" data-addr="${c.addr}">Submit dispute</button></div>
              <div class="hint">Window closes ${rel(c.disputeEnd)}. Max 2 disputes per participant.</div>` : ""}
          </div>

          <div class="card" style="margin-top:18px"><h3>Audit trail</h3>
            ${events.length ? `<ul class="timeline" style="margin-top:14px">${events.map((e) => `<li>${esc(e.text)}<small>${esc(e.name)} · block ${e.block}</small></li>`).join("")}</ul>` : '<p class="hint" style="margin-top:8px">No events yet.</p>'}
          </div>
        </div>

        <aside>
          <div class="card" style="border-color:rgba(61,220,151,.35)">
            <div class="mono" style="font-size:12px;color:var(--muted)">PRIZE POOL</div>
            <div class="prize" style="font-size:32px;margin:6px 0 12px">${prizeStr(c)}</div>
            ${c.prizes.map((p, i) => kv(`#${i + 1}`, `<b class="mono">${fmtAmt(p, c.decimals)} ${esc(c.symbol)}</b>`)).join("")}
            ${c.funded ? '<div class="badge ok" style="margin-top:12px;display:inline-block">Escrowed on-chain</div>' : '<div class="badge p3" style="margin-top:12px;display:inline-block">Awaiting funding</div>'}
            ${actions.length ? `<div class="actions" style="flex-direction:column;align-items:stretch">${actions.join("")}</div>` : ""}
          </div>
          <div class="card" style="margin-top:18px"><h3>Timeline</h3>
            ${kv("Deadline", dt(c.deadline))}${kv("Judging ends", dt(c.judgingEnd))}${kv("Dispute window", Math.round(c.disputeWindow / 86400) + " days")}
            ${kv("Participants", c.participantCount)}${kv("Submissions", c.submissionCount)}${kv("Min judge scores", c.minJudgeScores)}${kv("Entries / developer", c.maxSubmissionsPerDev ?? 1)}
          </div>
          <div class="card" style="margin-top:18px"><h3>Judges (${det.judges.length})</h3>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">${det.judges.map(devChip).join("") || '<span class="hint">None yet</span>'}</div>
            ${isOrg && c.phase <= 1 ? `<div class="sep"></div><label style="margin-top:0">Authorize judge</label><input id="j-addr" placeholder="0x…"><div class="actions"><button class="btn sm" data-act="addJudge" data-addr="${c.addr}">Add judge</button></div><div class="hint">Locked at the deadline. Participants can't be judges.</div>` : ""}
            <div class="sep"></div>${kv("Arbiter", devChip(c.arbiter))}
          </div>
        </aside>
      </div>`);
  }

  async function createPage() {
    if (!DEMO && !S.account) return view(`<div class="page-title"><h1>Create a challenge</h1></div>${needWallet()}`);
    const reg = !DEMO && S.account ? await D.registry().isRegistered(S.account) : true;
    const def = new Date(Date.now() + 14 * 86400e3); def.setMinutes(def.getMinutes() - def.getTimezoneOffset());
    view(`
      <div class="page-title"><div class="prompt">codearena create</div><h1>Publish a challenge</h1><p>Define the problem, prizes and rules. You'll fund the escrow in the next step.</p></div>
      ${reg ? "" : `<div class="card" style="margin-bottom:20px"><h2>1 · Organization profile</h2><p class="hint">Required once, public on-chain.</p>
        <form data-form="register"><label>Name</label><input name="name" required maxlength="80"><label>Website</label><input name="website" placeholder="https://"><label>About</label><textarea name="desc" maxlength="500" style="min-height:70px"></textarea>
        <div class="actions"><button class="btn primary">Register organization</button></div></form></div>`}
      <form data-form="create" class="card" ${reg ? "" : 'style="opacity:.5;pointer-events:none"'}>
        <h2>${reg ? "" : "2 · "}Challenge details</h2>
        <label>Title</label><input name="title" required maxlength="120" placeholder="e.g. Gas-optimised ZK verifier">
        <label>Description</label><textarea name="desc" maxlength="4000" placeholder="Problem statement, context, judging criteria…"></textarea>
        <label>Submission requirements</label><textarea name="req" maxlength="2000" placeholder="• Public GitHub repo&#10;• README + tests&#10;• Licence…"></textarea>
        <div class="row">
          <div><label>Difficulty</label><select name="diff">${[1, 2, 3, 4].map((d) => `<option value="${d}">${DIFFICULTY[d]}</option>`).join("")}</select></div>
          <div><label>Prize token</label><select name="token">${CFG.tokens.map((t, i) => `<option value="${i}">${esc(t.symbol)}</option>`).join("")}</select></div>
          <div><label>Submission deadline</label><input type="datetime-local" name="deadline" value="${def.toISOString().slice(0, 16)}" required></div>
        </div>
        <div class="row">
          <div><label>Judging period (days)</label><input type="number" name="jd" min="1" max="60" value="7"></div>
          <div><label>Dispute window (days)</label><input type="number" name="dw" min="1" max="30" value="3"></div>
          <div><label>Min judge scores</label><input type="number" name="minj" min="1" max="20" value="2"></div>
          <div><label>Entries per developer</label><input type="number" name="maxs" min="1" max="10" value="1"></div>
        </div>
        <label>Prize allocation (rank 1 first, non-increasing)</label>
        <div id="prizes"><div class="prize-row"><span>#1</span><input class="prize-in" type="number" step="any" min="0" placeholder="amount"></div><div class="prize-row"><span>#2</span><input class="prize-in" type="number" step="any" min="0" placeholder="amount"></div></div>
        <div class="actions"><button type="button" class="btn sm" data-act="addPrize">+ rank</button><button type="button" class="btn sm" data-act="rmPrize">− rank</button></div>
        <div class="hint">Total escrow = sum of prizes. Unawarded prizes return to you. One entry per developer prevents duplicate submissions.</div>
        <div class="actions" style="margin-top:22px"><button class="btn primary">Create challenge</button></div>
      </form>`);
  }

  async function submitPage(addr) {
    if (!addr) {
      const open = (await D.loadAll()).filter((c) => c.phase === 1);
      return view(`<div class="page-title"><h1>Submit your work</h1><p>Pick an open challenge.</p></div>${open.length ? `<div class="grid">${open.map(card).join("")}</div>` : empty("No open challenges.")}`);
    }
    loading();
    const c = await getC(addr);
    const isPart = !DEMO && S.account ? await D.ch(addr).isParticipant(S.account) : false;
    const mine = !DEMO && S.account ? (await D.ch(addr).submissionsOf(S.account)).length : 0;
    view(`
      <div class="page-title"><div class="prompt">codearena submit</div><h1>Submit to “${esc(c.title)}”</h1><p>${phaseBadge(c.phase)} &nbsp;closes ${rel(c.deadline)} · ${prizeStr(c)}</p></div>
      ${c.phase !== 1 ? '<div class="alert warn">This challenge is not accepting submissions.</div>' : ""}
      ${!S.account && !DEMO ? needWallet() : ""}
      ${S.account && !isPart && c.phase === 1 ? `<div class="alert info">You must join before submitting. <button class="btn sm" data-act="join" data-addr="${addr}" style="margin-left:8px">Join challenge</button></div>` : ""}
      ${mine >= (c.maxSubmissionsPerDev ?? 1) && mine > 0 ? '<div class="alert warn">You have reached the submission limit for this challenge.</div>' : ""}
      <div class="split"><form class="card" data-form="submit" data-addr="${addr}">
        <label>GitHub repository URL (or ipfs:// reference)</label><input name="repo" required placeholder="https://github.com/you/project" maxlength="300">
        <label>Commit hash / release tag</label><input name="commit" required placeholder="e.g. 9fceb02d0ae5…" maxlength="120">
        <div class="hint">Judges review exactly this commit. Changes after the deadline are ignored.</div>
        <label>Content hash (computed locally)</label><input id="hash" readonly class="mono" value="—">
        <div class="hint">keccak256(normalized repo + "@" + commit). Stored on-chain and must be unique, so the same entry can't be filed by two wallets.</div>
        <div class="actions"><button class="btn primary">Submit on-chain</button></div></form>
        <div class="card"><h3>Requirements</h3><div class="sep" style="margin:12px 0"></div><div class="prose">${esc(c.requirements)}</div></div></div>`);
    const upd = () => { const f = $('[data-form="submit"]'); $("#hash").value = f.repo.value && f.commit.value ? hashOf(f.repo.value, f.commit.value) : "—"; };
    $$('[data-form="submit"] input').forEach((i) => i.addEventListener("input", upd));
  }
  const hashOf = (repo, commit) => ethers.id(repo.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "") + "@" + commit.trim().toLowerCase());

  async function devPage(addr) {
    const target = addr || S.account;
    if (!target && !DEMO) return view(`<div class="page-title"><h1>Developer dashboard</h1></div>${needWallet()}`);
    loading();
    const list = await D.loadAll();
    const t = target || (DEMO ? (await D.loadDetail(list[0])).subs[0].dev : D.ZERO);
    const rows = [];
    await Promise.all(list.map(async (c) => {
      const det = await D.loadDetail(c);
      const mine = det.subs.filter((s) => same(s.dev, t));
      const joined = mine.length || (!DEMO && (await D.ch(c.addr).isParticipant(t)));
      if (!joined) return;
      const cl = !DEMO && det.winners.length ? await Promise.all(det.winners.map((_, i) => D.ch(c.addr).prizeClaimed(i))) : [];
      rows.push({ c, det, mine, cl });
    }));
    rows.sort((a, b) => b.c.deadline - a.c.deadline);
    let wins = 0; const won = {};
    rows.forEach(({ c, det }) => det.winners.forEach((sid, i) => { if (same(det.subs.find((s) => s.id === sid)?.dev, t) && c.phase >= 4) { wins++; won[c.symbol] = (won[c.symbol] || 0n) + c.prizes[i] * 1n; } }));
    const wonTxt = Object.entries(won).map(([s, v]) => `${fmtAmt(v, rows.find((r) => r.c.symbol === s).c.decimals)} ${s}`).join(" + ") || "0";
    view(`
      <div class="page-title"><div class="prompt">codearena profile</div>
        <div class="profile"><i class="av" style="${avatar(t)}"></i><div><h1 class="mono" style="font-size:24px">${short(t)}</h1><p class="mono" style="font-size:12.5px">${t}</p></div></div></div>
      <div class="stats"><div class="stat"><b>${rows.length}</b><span>competitions joined</span></div><div class="stat"><b>${rows.reduce((a, r) => a + r.mine.length, 0)}</b><span>submissions</span></div><div class="stat"><b>${wins}</b><span>wins</span></div><div class="stat"><b style="font-size:18px">${esc(wonTxt)}</b><span>prizes won</span></div></div>
      <h2 style="margin-bottom:14px">Competition history</h2>
      ${rows.length ? `<div class="card scroll"><table class="tbl"><thead><tr><th>Challenge</th><th>Phase</th><th>My submission</th><th>Score</th><th>Result</th><th></th></tr></thead><tbody>${rows.map(({ c, det, mine, cl }) => {
        const s = mine[0];
        const st = s ? subStatus(c, s, det.winners) : ["Joined — no submission", ""];
        const wi = s ? det.winners.indexOf(s.id) : -1;
        const btn = wi >= 0 && c.phase === 5 && same(S.account, t) ? (cl[wi] ? '<span class="badge ok">Claimed</span>' : `<button class="btn primary sm" data-act="claim" data-addr="${c.addr}" data-rank="${wi}">Claim ${fmtAmt(c.prizes[wi], c.decimals)} ${esc(c.symbol)}</button>`) : (c.phase === 1 && !s && same(S.account, t) ? `<a class="btn sm" href="#/submit/${c.addr}">Submit</a>` : "");
        return `<tr><td><a class="link" href="#/challenge/${c.addr}">${esc(c.title)}</a></td><td>${phaseBadge(c.phase)}</td><td class="mono" style="font-size:12.5px">${s ? esc(s.uri.replace(/^https?:\/\//, "").slice(0, 30)) : "—"}</td><td class="mono">${s && avg(s) !== null ? avg(s).toFixed(1) : "—"}</td><td><span class="badge ${st[1]}">${st[0]}</span></td><td>${btn}</td></tr>`;
      }).join("")}</tbody></table></div>` : empty("No competition history yet.", `<a class="btn primary" href="#/explore">Find a challenge</a>`)}`);
  }

  async function orgPage(addr) {
    const target = addr || S.account;
    if (!target && !DEMO) return view(`<div class="page-title"><h1>Organizer dashboard</h1></div>${needWallet()}`);
    loading();
    const t = target || (DEMO ? (await D.loadAll())[0].organizer : D.ZERO);
    const p = await D.loadProfile(t);
    if (!p.exists) return view(`<div class="page-title"><h1>Organizer dashboard</h1></div>${empty("This address has no organization profile.", `<a class="btn primary" href="#/create">Register &amp; create a challenge</a>`)}`);
    const list = await D.loadByOrganizer(t);
    const own = same(S.account, t);
    const todo = (c) => ({ 0: own ? "Fund the prize pool" : "", 1: "Collecting submissions", 2: "Judges are scoring", 3: own ? "Approve winners" : "Awaiting winner approval", 4: "Dispute window", 5: own && c.totalPrize > 0n ? "Check remainder / done" : "Done", 6: "Cancelled" }[c.phase]);
    view(`
      <div class="page-title"><div class="prompt">codearena organizer</div><h1>${esc(p.name)} ${p.verified ? '<span class="badge ok">verified</span>' : ""}</h1>
        <p>${esc(p.description)} ${p.website ? `· <a class="link" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(p.website))}">${esc(p.website)}</a>` : ""}</p></div>
      <div class="actions" style="margin:-8px 0 22px">${own ? '<a class="btn primary" href="#/create">+ New challenge</a>' : ""}</div>
      ${list.length ? `<div class="card scroll"><table class="tbl"><thead><tr><th>Challenge</th><th>Pool</th><th>Phase</th><th>Submissions</th><th>Next step</th></tr></thead><tbody>${list.map((c) => `<tr><td><a class="link" href="#/challenge/${c.addr}">${esc(c.title)}</a></td><td class="mono">${prizeStr(c)}</td><td>${phaseBadge(c.phase)}</td><td>${c.submissionCount}</td><td>${todo(c)}</td></tr>`).join("")}</tbody></table></div>` : empty("No challenges published yet.")}`);
  }

  async function judgePage() {
    if (!S.account && !DEMO) return view(`<div class="page-title"><h1>Judge dashboard</h1></div>${needWallet()}`);
    loading();
    const list = await D.loadAll();
    const mine = [];
    await Promise.all(list.map(async (c) => {
      const ok = DEMO ? c.phase === 2 : await D.ch(c.addr).isJudge(S.account);
      if (ok) mine.push(c);
    }));
    if (!mine.length) return view(`<div class="page-title"><h1>Judge dashboard</h1></div>${empty("You haven't been authorized as a judge on any challenge. Organizers add judges before a challenge's deadline.")}`);
    const blocks = await Promise.all(mine.map(async (c) => {
      const det = await D.loadDetail(c);
      const reviews = DEMO ? {} : Object.fromEntries(await Promise.all(det.subs.map(async (s) => [s.id, await D.ch(c.addr).reviewOf(s.id, S.account)])));
      const live = c.phase === 2;
      return `<div class="card" style="margin-bottom:20px"><div class="ch-top"><h3><a class="link" href="#/challenge/${c.addr}">${esc(c.title)}</a></h3>${phaseBadge(c.phase)}</div>
        <p class="hint" style="margin-bottom:12px">${live ? `Scoring open until ${dt(c.judgingEnd)}. You can revise scores until then; every change is logged.` : c.phase === 1 ? `Scoring opens ${dt(c.deadline)}.` : "Scoring closed."}</p>
        ${det.subs.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>#</th><th>Developer</th><th>Repository</th><th>My score</th><th>Avg</th>${live ? "<th>Score (0–100)</th><th>Notes</th><th></th>" : ""}</tr></thead><tbody>${det.subs.map((s) => {
          const r = reviews[s.id];
          return `<tr><td class="mono">${s.id}</td><td>${devChip(s.dev)}</td><td><a class="link mono" style="font-size:12.5px" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(s.uri))}">${esc(s.uri.replace(/^https?:\/\//, "").slice(0, 34))}</a></td><td class="mono">${r?.exists ? Number(r.score) : "—"}</td><td class="mono">${avg(s) === null ? "—" : avg(s).toFixed(1)}</td>
          ${live && !s.disqualified ? `<td><input id="sc-${c.addr}-${s.id}" type="number" min="0" max="100" style="width:90px" value="${r?.exists ? Number(r.score) : ""}"></td><td><input id="nt-${c.addr}-${s.id}" placeholder="evaluation notes (hashed)"></td><td><button class="btn primary sm" data-act="score" data-addr="${c.addr}" data-id="${s.id}">${r?.exists ? "Revise" : "Score"}</button></td>` : live ? "<td colspan=3><span class='badge bad'>Disqualified</span></td>" : ""}</tr>`;
        }).join("")}</tbody></table></div>` : empty("No submissions.")}
        ${live ? '<div class="hint">Only the keccak256 hash of your notes goes on-chain. Publish the full text (e.g. a gist) so the hash can be verified.</div>' : ""}</div>`;
    }));
    view(`<div class="page-title"><div class="prompt">codearena judge</div><h1>Judge dashboard</h1><p>${mine.length} assigned challenge${mine.length > 1 ? "s" : ""}.</p></div>${blocks.join("")}`);
  }

  async function lbPage() {
    loading();
    const list = (await D.loadAll()).filter((c) => c.phase >= 4);
    const agg = {};
    await Promise.all(list.map(async (c) => {
      const det = await D.loadDetail(c);
      det.winners.forEach((sid, i) => {
        const s = det.subs.find((x) => x.id === sid); if (!s) return;
        const k = s.dev.toLowerCase();
        agg[k] ??= { dev: s.dev, wins: 0, earned: {}, scores: [] };
        agg[k].wins++; agg[k].earned[c.symbol] = [(agg[k].earned[c.symbol]?.[0] || 0n) + c.prizes[i], c.decimals];
        if (avg(s) !== null) agg[k].scores.push(avg(s));
      });
    }));
    const rows = Object.values(agg).sort((a, b) => b.wins - a.wins || b.scores.length - a.scores.length);
    view(`<div class="page-title"><div class="prompt">codearena leaderboard</div><h1>Developer leaderboard</h1><p>Ranked by verified wins across finalized competitions.</p></div>
      ${rows.length ? `<div class="card scroll"><table class="tbl"><thead><tr><th>Rank</th><th>Developer</th><th>Wins</th><th>Prizes won</th><th>Avg winning score</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="rank ${["r0", "r1", "r2"][i] || ""}">#${i + 1}</td><td>${devChip(r.dev)}</td><td class="mono">${r.wins}</td><td class="mono">${Object.entries(r.earned).map(([s, [v, d]]) => `${fmtAmt(v, d)} ${esc(s)}`).join(" + ")}</td><td class="mono">${(r.scores.reduce((a, b) => a + b, 0) / (r.scores.length || 1)).toFixed(1)}</td></tr>`).join("")}</tbody></table></div>` : empty("No finalized competitions yet.")}`);
  }

  // ───────────── actions ─────────────
  const nz = (v) => (v == null || v === "" ? 0 : Number(v));
  const ACT = {
    connect,
    addPrize() { const n = $$(".prize-row").length + 1; if (n > 10) return; $("#prizes").insertAdjacentHTML("beforeend", `<div class="prize-row"><span>#${n}</span><input class="prize-in" type="number" step="any" min="0" placeholder="amount"></div>`); },
    rmPrize() { const rows = $$(".prize-row"); if (rows.length > 1) rows.at(-1).remove(); },
    join: (d) => run("Joining", () => D.ch(d.addr, true).join()),
    cancel: (d) => run("Cancelling", () => D.ch(d.addr, true).cancel()),
    withdraw: (d) => run("Withdrawing remainder", () => D.ch(d.addr, true).withdrawRemainder()),
    claim: (d) => run("Claiming prize", () => D.ch(d.addr, true).claimPrize(d.rank)),
    expire: (d) => run("Expiring dispute", () => D.ch(d.addr, true).expireDispute(d.id)),
    addJudge(d) {
      const a = $("#j-addr").value.trim();
      if (!ethers.isAddress(a)) return toast("Enter a valid address", true);
      return run("Authorizing judge", () => D.ch(d.addr, true).addJudge(a));
    },
    async fund(d) {
      const c = await getC(d.addr);
      return run("Funding escrow", async () => {
        if (c.token !== ZERO) {
          const tk = new ethers.Contract(c.token, ABIS.erc20, S.signer);
          if ((await tk.allowance(S.account, c.addr)) < c.totalPrize) { toast("Approve token spend…"); await (await tk.approve(c.addr, c.totalPrize)).wait(); }
        }
        return D.ch(c.addr, true).fund(c.token === ZERO ? { value: c.totalPrize } : {});
      });
    },
    async finalize(d) {
      const c = await getC(d.addr), det = await D.loadDetail(c);
      const ids = winnerIds(c, det.subs);
      return run("Approving winners", () => D.ch(d.addr, true).finalize(ids));
    },
    score(d) {
      const v = $(`#sc-${d.addr}-${d.id}`).value, notes = $(`#nt-${d.addr}-${d.id}`).value.trim();
      if (v === "" || +v < 0 || +v > 100 || !Number.isInteger(+v)) return toast("Score must be an integer 0–100", true);
      return run("Submitting score", () => D.ch(d.addr, true).score(d.id, +v, notes ? ethers.id(notes) : ethers.ZeroHash));
    },
    dispute(d) {
      const id = $("#dp-id").value, ev = $("#dp-ev").value.trim();
      if (!/^(https?|ipfs):\/\//.test(ev)) return toast("Evidence must be an https:// or ipfs:// link", true);
      return run("Raising dispute", () => D.ch(d.addr, true).raiseDispute(id, ev));
    },
    resolve(d) {
      const note = ethers.id("arbiter-decision-" + d.id + "-" + Date.now());
      if (d.mode === "reject") return run("Rejecting dispute", () => D.ch(d.addr, true).resolveDispute(d.id, false, false, 0, note));
      if (d.mode === "dq") return run("Disqualifying", () => D.ch(d.addr, true).resolveDispute(d.id, true, true, 0, note));
      const v = $(`#ns-${d.id}`).value; if (v === "" || +v < 0 || +v > 100) return toast("Enter a new score 0–100", true);
      return run("Adjusting score", () => D.ch(d.addr, true).resolveDispute(d.id, true, false, +v, note));
    },
  };
  const FORMS = {
    register(f) {
      return run("Registering organization", () => D.registry(true).register(f.name.value.trim(), f.website.value.trim(), f.desc.value.trim()));
    },
    async create(f) {
      const tk = CFG.tokens[+f.token.value];
      const prizes = $$(".prize-in", f).map((i) => i.value).filter((v) => v !== "").map((v) => ethers.parseUnits(v, tk.decimals));
      if (!prizes.length) return toast("Add at least one prize", true);
      const deadline = Math.floor(new Date(f.deadline.value).getTime() / 1000);
      const p = { title: f.title.value.trim(), description: f.desc.value, requirements: f.req.value, difficulty: +f.diff.value, token: tk.address, deadline, judgingPeriod: nz(f.jd.value) * 86400, disputeWindow: nz(f.dw.value) * 86400, minJudgeScores: nz(f.minj.value), maxSubmissionsPerDev: nz(f.maxs.value), prizes };
      const rc = await run("Creating challenge", () => D.factory(true).createChallenge(p));
      if (!rc) return;
      const fi = D.factory().interface;
      for (const l of rc.logs) { try { const e = fi.parseLog(l); if (e?.name === "ChallengeCreated") { location.hash = "#/challenge/" + e.args.challenge; toast("Created! Now fund the escrow to open it."); return; } } catch {} }
    },
    async submit(f) {
      const repo = f.repo.value.trim();
      if (!/^(https:\/\/|ipfs:\/\/)/i.test(repo)) return toast("Repository must be an https:// or ipfs:// URL", true);
      const rc = await run("Submitting", () => D.ch(f.dataset.addr, true).submit(repo, hashOf(repo, f.commit.value)));
      if (rc) location.hash = "#/challenge/" + f.dataset.addr;
    },
  };

  // ───────────── router ─────────────
  const A = "(0x[0-9a-fA-F]{40})";
  const routes = [
    [/^#\/?$/, landing], [/^#\/explore/, explore], [new RegExp(`^#/challenge/${A}`), challengePage], [/^#\/create/, createPage],
    [new RegExp(`^#/submit(?:/${A})?`), submitPage], [new RegExp(`^#/developer(?:/${A})?`), devPage],
    [new RegExp(`^#/organizer(?:/${A})?`), orgPage], [/^#\/judge/, judgePage], [/^#\/leaderboard/, lbPage],
  ];
  async function route() {
    header();
    const h = location.hash || "#/";
    for (const [re, fn] of routes) {
      const m = h.match(re);
      if (!m) continue;
      try { await fn(...m.slice(1)); }
      catch (e) { console.error(e); view(`<div class="alert warn">Could not load data from the chain: ${esc(errMsg(e))}<br><span class="hint">Check <code>js/config.js</code> (RPC URL, factory address) and that your wallet is on ${esc(CFG.chainName)}.</span></div>`); }
      return;
    }
    view(empty("Page not found.", '<a class="btn" href="#/">Home</a>'));
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || !ACT[b.dataset.act]) return;
    e.preventDefault();
    Promise.resolve(ACT[b.dataset.act]({ ...b.dataset }, b)).catch((er) => toast(errMsg(er), true));
  });
  document.addEventListener("submit", (e) => {
    const f = e.target.closest("[data-form]");
    if (!f) return;
    e.preventDefault();
    Promise.resolve(FORMS[f.dataset.form](f)).catch((er) => toast(errMsg(er), true));
  });
  window.addEventListener("hashchange", route);
  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => { S.account = null; S.signer = null; connect(); });
    window.ethereum.on?.("chainChanged", () => location.reload());
  }
  route();
})();
