const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;
const U = (n) => ethers.parseUnits(String(n), 6);
const h = (s) => ethers.id(s);
const Phase = { Unfunded: 0, Open: 1, Judging: 2, AwaitingFinalization: 3, DisputeWindow: 4, Completed: 5, Cancelled: 6 };

async function deployAll() {
  const [owner, arbiter, org, d1, d2, d3, j1, j2, other] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("OrganizerRegistry")).deploy();
  const factory = await (await ethers.getContractFactory("ChallengeFactory")).deploy(await registry.getAddress(), arbiter.address);
  const usdt = await (await ethers.getContractFactory("MockToken")).deploy("USDT", "USDT", 6);
  await factory.setTokenAllowed(await usdt.getAddress(), true);
  await usdt.mint(org.address, U(10000));
  await registry.connect(org).register("Acme Labs", "https://acme.dev", "We build things");
  return { owner, arbiter, org, d1, d2, d3, j1, j2, other, registry, factory, usdt };
}

async function create(ctx, overrides = {}, native = false) {
  const { factory, org, usdt } = ctx;
  const now = await time.latest();
  const p = {
    title: "Build a ZK verifier", description: "desc", requirements: "reqs", difficulty: 3,
    token: native ? ethers.ZeroAddress : await usdt.getAddress(),
    deadline: now + 7 * DAY, judgingPeriod: 7 * DAY, disputeWindow: 3 * DAY,
    minJudgeScores: 2, maxSubmissionsPerDev: 1,
    prizes: native ? [ethers.parseEther("5"), ethers.parseEther("3")] : [U(500), U(300)],
    ...overrides,
  };
  const tx = await factory.connect(org).createChallenge(p);
  const rc = await tx.wait();
  const ev = rc.logs
    .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((e) => e && e.name === "ChallengeCreated");
  const c = await ethers.getContractAt("Challenge", ev.args.challenge);
  return { c, p };
}

async function fundErc20(ctx, c, total = U(800)) {
  await ctx.usdt.connect(ctx.org).approve(await c.getAddress(), total);
  await c.connect(ctx.org).fund();
}

/** 3 devs submit, 2 judges score. Averages: sub0=85, sub1=90, sub2=65 → ranking [1,0,2] */
async function scenario(ctx) {
  const { c } = await create(ctx);
  await c.connect(ctx.org).addJudge(ctx.j1.address);
  await c.connect(ctx.org).addJudge(ctx.j2.address);
  await fundErc20(ctx, c);
  for (const [i, d] of [ctx.d1, ctx.d2, ctx.d3].entries()) {
    await c.connect(d).join();
    await c.connect(d).submit(`https://github.com/dev${i}/repo`, h(`commit${i}`));
  }
  await time.increase(7 * DAY + 1);
  const sc = [[80, 90], [95, 85], [70, 60]];
  for (let i = 0; i < 3; i++) {
    await c.connect(ctx.j1).score(i, sc[i][0], h("n"));
    await c.connect(ctx.j2).score(i, sc[i][1], h("n"));
  }
  return c;
}

describe("CodeArena", () => {
  describe("Registry & factory", () => {
    it("registers organizers once and blocks unregistered publishers", async () => {
      const ctx = await loadFixture(deployAll);
      await expect(ctx.registry.connect(ctx.org).register("x", "", "")).to.be.revertedWith("already registered");
      const now = await time.latest();
      await expect(ctx.factory.connect(ctx.other).createChallenge({
        title: "t", description: "", requirements: "", difficulty: 1, token: ethers.ZeroAddress, deadline: now + 2 * DAY,
        judgingPeriod: DAY, disputeWindow: DAY, minJudgeScores: 1, maxSubmissionsPerDev: 1, prizes: [1],
      })).to.be.revertedWith("register organization first");
    });

    it("rejects non-allow-listed tokens and invalid params", async () => {
      const ctx = await loadFixture(deployAll);
      await expect(create(ctx, { token: ctx.other.address })).to.be.revertedWith("token not allowed");
      await expect(create(ctx, { difficulty: 9 })).to.be.revertedWith("bad difficulty");
      await expect(create(ctx, { prizes: [U(1), U(2)] })).to.be.revertedWith("prizes must not increase");
      await expect(create(ctx, { prizes: [] })).to.be.revertedWith("bad prize count");
    });

    it("tracks challenges by organizer", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      expect(await ctx.factory.challengesByOrganizer(ctx.org.address)).to.deep.equal([await c.getAddress()]);
    });
  });

  describe("Escrow", () => {
    it("escrows exact amount and blocks double funding / non-organizer funding", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      await expect(c.connect(ctx.other).fund()).to.be.revertedWith("not organizer");
      await fundErc20(ctx, c);
      expect(await ctx.usdt.balanceOf(await c.getAddress())).to.equal(U(800));
      expect((await c.info()).phase).to.equal(Phase.Open);
      await expect(c.connect(ctx.org).fund()).to.be.revertedWith("cannot fund");
    });

    it("supports native-currency prize pools", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx, {}, true);
      await expect(c.connect(ctx.org).fund({ value: 1n })).to.be.revertedWith("wrong native amount");
      await c.connect(ctx.org).fund({ value: ethers.parseEther("8") });
      expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(ethers.parseEther("8"));
    });

    it("cancel refunds when there are no submissions, and is blocked once work exists", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      await fundErc20(ctx, c);
      const before = await ctx.usdt.balanceOf(ctx.org.address);
      await c.connect(ctx.org).cancel();
      expect(await ctx.usdt.balanceOf(ctx.org.address)).to.equal(before + U(800));
      expect((await c.info()).phase).to.equal(Phase.Cancelled);

      const { c: c2 } = await create(ctx);
      await fundErc20(ctx, c2);
      await c2.connect(ctx.d1).join();
      await c2.connect(ctx.d1).submit("https://github.com/a/b", h("x"));
      await expect(c2.connect(ctx.org).cancel()).to.be.revertedWith("submissions exist");
    });
  });

  describe("Participation & submissions", () => {
    it("enforces join-first, per-dev limit, global duplicate hash, deadline", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      await fundErc20(ctx, c);
      await expect(c.connect(ctx.d1).submit("https://g/a", h("a"))).to.be.revertedWith("join first");
      await c.connect(ctx.d1).join();
      await expect(c.connect(ctx.d1).join()).to.be.revertedWith("already joined");
      await c.connect(ctx.d1).submit("https://g/a", h("a"));
      await expect(c.connect(ctx.d1).submit("https://g/b", h("b"))).to.be.revertedWith("submission limit");
      await c.connect(ctx.d2).join();
      await expect(c.connect(ctx.d2).submit("https://g/a-copy", h("a"))).to.be.revertedWith("duplicate submission");
      await time.increase(7 * DAY + 1);
      await expect(c.connect(ctx.d2).submit("https://g/z", h("z"))).to.be.revertedWith("not open");
    });

    it("allows multiple submissions only when configured", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx, { maxSubmissionsPerDev: 2 });
      await fundErc20(ctx, c);
      await c.connect(ctx.d1).join();
      await c.connect(ctx.d1).submit("https://g/a", h("a"));
      await c.connect(ctx.d1).submit("https://g/b", h("b"));
      await expect(c.connect(ctx.d1).submit("https://g/c", h("c"))).to.be.revertedWith("submission limit");
    });

    it("keeps roles separate (judge/organizer cannot compete, participant cannot judge)", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      await c.connect(ctx.org).addJudge(ctx.j1.address);
      await fundErc20(ctx, c);
      await expect(c.connect(ctx.j1).join()).to.be.revertedWith("conflicted role");
      await expect(c.connect(ctx.org).join()).to.be.revertedWith("conflicted role");
      await c.connect(ctx.d1).join();
      await expect(c.connect(ctx.org).addJudge(ctx.d1.address)).to.be.revertedWith("judge is participant");
      await expect(c.connect(ctx.other).addJudge(ctx.other.address)).to.be.revertedWith("not organizer");
    });

    it("locks judge list at the deadline", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      await time.increase(7 * DAY + 1);
      await expect(c.connect(ctx.org).addJudge(ctx.j1.address)).to.be.revertedWith("judge list locked");
    });
  });

  describe("Judging & winner selection", () => {
    it("only authorized judges score, only inside the judging window, with revisions logged", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      await c.connect(ctx.org).addJudge(ctx.j1.address);
      await fundErc20(ctx, c);
      await c.connect(ctx.d1).join();
      await c.connect(ctx.d1).submit("https://g/a", h("a"));
      await expect(c.connect(ctx.j1).score(0, 50, h("n"))).to.be.revertedWith("not judging window");
      await time.increase(7 * DAY + 1);
      await expect(c.connect(ctx.other).score(0, 50, h("n"))).to.be.revertedWith("not judge");
      await expect(c.connect(ctx.j1).score(0, 101, h("n"))).to.be.revertedWith("score > 100");
      await c.connect(ctx.j1).score(0, 50, h("n"));
      await expect(c.connect(ctx.j1).score(0, 70, h("n2")))
        .to.emit(c, "ReviewSubmitted").withArgs(0, ctx.j1.address, 70, h("n2"), true);
      const s = await c.getSubmission(0);
      expect(s.judgeCount).to.equal(1);
      expect(s.scoreSum).to.equal(70);
    });

    it("verifies ranking on-chain: wrong order, omission and wrong count all revert", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await time.increase(7 * DAY);
      await expect(c.connect(ctx.other).finalize([1, 0])).to.be.revertedWith("not authorized");
      await expect(c.connect(ctx.org).finalize([0, 1])).to.be.revertedWith("bad order");
      await expect(c.connect(ctx.org).finalize([1, 2])).to.be.revertedWith("omitted higher ranked");
      await expect(c.connect(ctx.org).finalize([1])).to.be.revertedWith("wrong winner count");
      await expect(c.connect(ctx.org).finalize([1, 1])).to.be.revertedWith("bad order");
      await c.connect(ctx.org).finalize([1, 0]);
      expect((await c.winners()).map(Number)).to.deep.equal([1, 0]);
      await expect(c.connect(ctx.org).finalize([1, 0])).to.be.revertedWith("already finalized");
    });

    it("cannot finalize while judging is ongoing", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await expect(c.connect(ctx.org).finalize([1, 0])).to.be.revertedWith("judging ongoing");
    });

    it("lets anyone finalize (with a verified ranking) after the grace period", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await time.increase(7 * DAY + 7 * DAY + 1);
      await c.connect(ctx.other).finalize([1, 0]);
      expect(await c.finalized()).to.equal(true);
    });

    it("breaks ties by earlier submission", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx, { prizes: [U(500)] });
      await c.connect(ctx.org).addJudge(ctx.j1.address);
      await c.connect(ctx.org).addJudge(ctx.j2.address);
      await fundErc20(ctx, c, U(500));
      for (const [i, d] of [ctx.d1, ctx.d2].entries()) {
        await c.connect(d).join();
        await c.connect(d).submit(`https://g/${i}`, h(`t${i}`));
      }
      await time.increase(7 * DAY + 1);
      for (const j of [ctx.j1, ctx.j2]) {
        for (const i of [0, 1]) await c.connect(j).score(i, 80, h("n"));
      }
      await time.increase(7 * DAY);
      await expect(c.connect(ctx.org).finalize([1])).to.be.revertedWith("omitted higher ranked");
      await c.connect(ctx.org).finalize([0]);
    });
  });

  describe("Claims", () => {
    it("pays winners once, only after the dispute window", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await time.increase(7 * DAY);
      await c.connect(ctx.org).finalize([1, 0]);
      await expect(c.connect(ctx.d2).claimPrize(0)).to.be.revertedWith("claims not open");
      await time.increase(3 * DAY + 1);
      await expect(c.connect(ctx.d1).claimPrize(0)).to.be.revertedWith("not winner"); // d1 is rank 1
      await expect(c.connect(ctx.d3).claimPrize(1)).to.be.revertedWith("not winner");
      await expect(c.connect(ctx.d2).claimPrize(0)).to.changeTokenBalance(ctx.usdt, ctx.d2, U(500));
      await expect(c.connect(ctx.d2).claimPrize(0)).to.be.revertedWith("already claimed");
      await expect(c.connect(ctx.d1).claimPrize(1)).to.changeTokenBalance(ctx.usdt, ctx.d1, U(300));
      await expect(c.connect(ctx.d1).claimPrize(2)).to.be.revertedWith("no such rank");
      await expect(c.connect(ctx.org).withdrawRemainder()).to.be.revertedWith("nothing to withdraw");
      expect(await ctx.usdt.balanceOf(await c.getAddress())).to.equal(0);
    });

    it("refunds unawarded prizes when fewer eligible entries than prizes", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx, { minJudgeScores: 1 });
      await c.connect(ctx.org).addJudge(ctx.j1.address);
      await fundErc20(ctx, c);
      await c.connect(ctx.d1).join();
      await c.connect(ctx.d1).submit("https://g/a", h("a"));
      await time.increase(7 * DAY + 1);
      await c.connect(ctx.j1).score(0, 90, h("n"));
      await time.increase(7 * DAY);
      await c.connect(ctx.org).finalize([0]);
      await time.increase(3 * DAY + 1);
      await expect(c.connect(ctx.org).withdrawRemainder()).to.changeTokenBalance(ctx.usdt, ctx.org, U(300));
      await expect(c.connect(ctx.org).withdrawRemainder()).to.be.revertedWith("already withdrawn");
      await expect(c.connect(ctx.d1).claimPrize(0)).to.changeTokenBalance(ctx.usdt, ctx.d1, U(500));
    });

    it("refunds everything when no entry becomes eligible", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx);
      await fundErc20(ctx, c);
      await c.connect(ctx.d1).join();
      await c.connect(ctx.d1).submit("https://g/a", h("a"));
      await time.increase(14 * DAY + 1);
      await c.connect(ctx.org).finalize([]);
      expect((await c.info()).phase).to.equal(Phase.Completed);
      await expect(c.connect(ctx.org).withdrawRemainder()).to.changeTokenBalance(ctx.usdt, ctx.org, U(800));
    });

    it("pays native-currency winners", async () => {
      const ctx = await loadFixture(deployAll);
      const { c } = await create(ctx, { minJudgeScores: 1 }, true);
      await c.connect(ctx.org).addJudge(ctx.j1.address);
      await c.connect(ctx.org).fund({ value: ethers.parseEther("8") });
      await c.connect(ctx.d1).join();
      await c.connect(ctx.d1).submit("https://g/a", h("a"));
      await time.increase(7 * DAY + 1);
      await c.connect(ctx.j1).score(0, 77, h("n"));
      await time.increase(7 * DAY);
      await c.connect(ctx.org).finalize([0]);
      await time.increase(3 * DAY + 1);
      await expect(c.connect(ctx.d1).claimPrize(0)).to.changeEtherBalance(ctx.d1, ethers.parseEther("5"));
    });
  });

  describe("Disputes", () => {
    it("upheld score dispute forces re-rank; claims wait for it", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await time.increase(7 * DAY);
      await c.connect(ctx.org).finalize([1, 0]);

      await expect(c.connect(ctx.other).raiseDispute(2, "ipfs://evidence")).to.be.revertedWith("participants only");
      await c.connect(ctx.d3).raiseDispute(2, "ipfs://evidence");
      await expect(c.connect(ctx.org).resolveDispute(0, true, false, 100, h("note"))).to.be.revertedWith("not arbiter");
      await c.connect(ctx.arbiter).resolveDispute(0, true, false, 100, h("note"));
      expect(await c.needsReRank()).to.equal(true);

      await time.increase(3 * DAY + 1);
      await expect(c.connect(ctx.d2).claimPrize(0)).to.be.revertedWith("claims not open");
      await expect(c.connect(ctx.org).finalize([1, 0])).to.be.revertedWith("bad order");
      await c.connect(ctx.org).finalize([2, 1]);
      await expect(c.connect(ctx.d3).claimPrize(0)).to.changeTokenBalance(ctx.usdt, ctx.d3, U(500));
      await expect(c.connect(ctx.d2).claimPrize(1)).to.changeTokenBalance(ctx.usdt, ctx.d2, U(300));
      await expect(c.connect(ctx.d1).claimPrize(1)).to.be.revertedWith("already claimed");
    });

    it("arbiter can disqualify a plagiarised winner; next entry is promoted", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await time.increase(7 * DAY);
      await c.connect(ctx.org).finalize([1, 0]);
      await c.connect(ctx.d1).raiseDispute(1, "ipfs://plagiarism-proof");
      await c.connect(ctx.arbiter).resolveDispute(0, true, true, 0, h("copied"));
      await expect(c.connect(ctx.org).finalize([1, 0])).to.be.revertedWith("ineligible submission");
      await c.connect(ctx.org).finalize([0, 2]);
      await time.increase(3 * DAY + 1);
      await expect(c.connect(ctx.d2).claimPrize(0)).to.be.revertedWith("not winner");
      await expect(c.connect(ctx.d1).claimPrize(0)).to.changeTokenBalance(ctx.usdt, ctx.d1, U(500));
    });

    it("rejected dispute does not change results; limits and window are enforced", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await time.increase(7 * DAY);
      await c.connect(ctx.org).finalize([1, 0]);
      await c.connect(ctx.d3).raiseDispute(2, "ipfs://e1");
      await c.connect(ctx.d3).raiseDispute(2, "ipfs://e2");
      await expect(c.connect(ctx.d3).raiseDispute(2, "ipfs://e3")).to.be.revertedWith("dispute limit");
      await c.connect(ctx.arbiter).resolveDispute(0, false, false, 0, h("no"));
      await c.connect(ctx.arbiter).resolveDispute(1, false, false, 0, h("no"));
      await time.increase(3 * DAY + 1);
      await expect(c.connect(ctx.d3).raiseDispute(2, "ipfs://late")).to.be.revertedWith("dispute window closed");
      await expect(c.connect(ctx.d2).claimPrize(0)).to.changeTokenBalance(ctx.usdt, ctx.d2, U(500));
    });

    it("stale disputes expire so funds cannot be frozen by an absent arbiter", async () => {
      const ctx = await loadFixture(deployAll);
      const c = await scenario(ctx);
      await time.increase(7 * DAY);
      await c.connect(ctx.org).finalize([1, 0]);
      await c.connect(ctx.d3).raiseDispute(2, "ipfs://e");
      await time.increase(3 * DAY + 1);
      await expect(c.expireDispute(0)).to.be.revertedWith("arbiter timeout not reached");
      await expect(c.connect(ctx.d2).claimPrize(0)).to.be.revertedWith("claims not open");
      await time.increase(14 * DAY);
      await c.connect(ctx.other).expireDispute(0);
      await expect(c.connect(ctx.d2).claimPrize(0)).to.changeTokenBalance(ctx.usdt, ctx.d2, U(500));
    });
  });
});
