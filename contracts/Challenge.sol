// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Challenge
/// @notice One competition: prize escrow + submission registry + judge authorization +
///         scoring + verified winner selection + disputes + prize claims + refunds.
/// @dev    The contract NEVER evaluates code. It stores references/hashes, records judge scores,
///         and verifies on-chain that a proposed winner ranking is consistent with those scores.
///         Prize token is either the native currency (token == address(0)) or an ERC-20.
contract Challenge is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────────── constants ─────────────────────────────
    uint256 public constant MAX_SUBMISSIONS = 200;
    uint256 public constant MAX_PRIZES = 10;
    uint256 public constant MAX_JUDGES = 20;
    uint256 public constant MAX_DISPUTES = 50;
    uint8 public constant MAX_DISPUTES_PER_USER = 2;
    uint64 public constant FINALIZE_GRACE = 7 days;
    uint64 public constant ARBITER_TIMEOUT = 14 days;

    // ───────────────────────────── types ─────────────────────────────
    enum Phase { Unfunded, Open, Judging, AwaitingFinalization, DisputeWindow, Completed, Cancelled }
    enum DisputeStatus { None, Open, Rejected, Upheld, Expired }

    struct Params {
        string title;
        string description;
        string requirements;
        uint8 difficulty;          // 1 Beginner, 2 Intermediate, 3 Advanced, 4 Expert
        address token;             // address(0) = native currency
        uint64 deadline;           // submission deadline (unix)
        uint32 judgingPeriod;      // seconds after deadline during which judges may score
        uint32 disputeWindow;      // seconds after winner finalization during which disputes may be raised
        uint8 minJudgeScores;      // judge scores a submission needs to be eligible
        uint8 maxSubmissionsPerDev;// 1 = duplicate/extra submissions prohibited
        uint256[] prizes;          // prize per rank, rank 0 first
    }

    struct Submission {
        address dev;
        uint64 submittedAt;
        bool disqualified;
        uint16 judgeCount;
        uint32 scoreSum;
        bytes32 contentHash;
        string uri;
    }

    struct Review {
        bool exists;
        uint8 score;
        bytes32 notesHash;
    }

    struct Dispute {
        address raiser;
        uint256 submissionId;
        DisputeStatus status;
        uint64 createdAt;
        string evidenceURI;
    }

    struct Info {
        address organizer;
        address arbiter;
        address token;
        string title;
        string description;
        string requirements;
        uint8 difficulty;
        uint64 deadline;
        uint64 judgingEnd;
        uint64 disputeEnd;
        uint32 disputeWindow;
        uint8 minJudgeScores;
        uint8 maxSubmissionsPerDev;
        uint256 totalPrize;
        uint256[] prizes;
        Phase phase;
        uint256 submissionCount;
        uint256 participantCount;
        uint256 eligibleCount;
        uint256 openDisputes;
        bool funded;
        bool needsReRank;
    }

    // ───────────────────────────── immutables / config ─────────────────────────────
    address public immutable organizer;
    address public immutable arbiter;
    address public immutable token;
    uint8 public immutable difficulty;
    uint64 public immutable deadline;
    uint64 public immutable judgingEnd;
    uint32 public immutable disputeWindow;
    uint8 public immutable minJudgeScores;
    uint8 public immutable maxSubmissionsPerDev;
    uint256 public immutable totalPrize;

    string public title;
    string public description;
    string public requirements;
    uint256[] private _prizes;

    // ───────────────────────────── state ─────────────────────────────
    bool public funded;
    bool public cancelled;
    bool public finalized;
    bool public needsReRank;
    bool public remainderWithdrawn;
    uint64 public disputeEnd;
    uint64 public finalizeDeadline;
    uint256 public awarded;
    uint256 public eligibleCount;
    uint256 public openDisputes;

    Submission[] private _subs;
    mapping(uint256 => mapping(address => Review)) private _reviews;
    mapping(bytes32 => bool) public usedContentHash;
    mapping(address => uint256[]) private _subsOf;

    mapping(address => bool) public isParticipant;
    address[] private _participants;

    mapping(address => bool) public isJudge;
    address[] private _judges;

    uint256[] private _winners;
    mapping(uint256 => bool) public prizeClaimed; // by rank

    Dispute[] private _disputes;
    mapping(address => uint8) public disputesBy;

    // ───────────────────────────── events ─────────────────────────────
    event Funded(address indexed organizer, uint256 amount);
    event Cancelled(uint256 refunded);
    event Joined(address indexed dev);
    event Submitted(uint256 indexed id, address indexed dev, bytes32 contentHash, string uri);
    event JudgeAdded(address indexed judge);
    event JudgeRemoved(address indexed judge);
    event ReviewSubmitted(uint256 indexed id, address indexed judge, uint8 score, bytes32 notesHash, bool revised);
    event Disqualified(uint256 indexed id, bytes32 reasonHash);
    event ScoreAdjusted(uint256 indexed id, uint8 newScore);
    event WinnersFinalized(address indexed by, uint256[] ranked, uint64 disputeEnd, bool rerank);
    event DisputeRaised(uint256 indexed disputeId, uint256 indexed id, address indexed raiser, string evidenceURI);
    event DisputeResolved(uint256 indexed disputeId, DisputeStatus status, bool disqualified, uint8 newScore, bytes32 noteHash);
    event PrizeClaimed(uint256 indexed rank, address indexed dev, uint256 amount);
    event RemainderWithdrawn(address indexed organizer, uint256 amount);

    // ───────────────────────────── modifiers ─────────────────────────────
    modifier onlyOrganizer() {
        require(msg.sender == organizer, "not organizer");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "not arbiter");
        _;
    }

    // ───────────────────────────── constructor ─────────────────────────────
    constructor(address _organizer, address _arbiter, Params memory p) {
        require(_organizer != address(0) && _arbiter != address(0), "zero address");
        require(_organizer != _arbiter, "organizer == arbiter");
        require(bytes(p.title).length > 0 && bytes(p.title).length <= 120, "bad title");
        require(bytes(p.description).length <= 4000, "description too long");
        require(bytes(p.requirements).length <= 2000, "requirements too long");
        require(p.difficulty >= 1 && p.difficulty <= 4, "bad difficulty");
        require(p.deadline > block.timestamp + 1 hours, "deadline too soon");
        require(p.judgingPeriod >= 1 days && p.judgingPeriod <= 60 days, "bad judging period");
        require(p.disputeWindow >= 1 days && p.disputeWindow <= 30 days, "bad dispute window");
        require(p.minJudgeScores >= 1, "min scores = 0");
        require(p.maxSubmissionsPerDev >= 1, "max submissions = 0");
        require(p.prizes.length >= 1 && p.prizes.length <= MAX_PRIZES, "bad prize count");

        uint256 total;
        for (uint256 i = 0; i < p.prizes.length; i++) {
            require(p.prizes[i] > 0, "zero prize");
            if (i > 0) require(p.prizes[i] <= p.prizes[i - 1], "prizes must not increase");
            total += p.prizes[i];
        }

        organizer = _organizer;
        arbiter = _arbiter;
        token = p.token;
        difficulty = p.difficulty;
        deadline = p.deadline;
        judgingEnd = p.deadline + p.judgingPeriod;
        disputeWindow = p.disputeWindow;
        minJudgeScores = p.minJudgeScores;
        maxSubmissionsPerDev = p.maxSubmissionsPerDev;
        totalPrize = total;
        title = p.title;
        description = p.description;
        requirements = p.requirements;
        _prizes = p.prizes;
        finalizeDeadline = p.deadline + p.judgingPeriod + FINALIZE_GRACE;
    }

    // ───────────────────────────── escrow ─────────────────────────────

    /// @notice Organizer deposits the full prize pool. Competition opens once funded.
    function fund() external payable onlyOrganizer nonReentrant {
        require(!funded && !cancelled, "cannot fund");
        require(block.timestamp < deadline, "past deadline");
        funded = true;
        if (token == address(0)) {
            require(msg.value == totalPrize, "wrong native amount");
        } else {
            require(msg.value == 0, "native not accepted");
            IERC20(token).safeTransferFrom(msg.sender, address(this), totalPrize);
        }
        emit Funded(msg.sender, totalPrize);
    }

    /// @notice Cancel and refund. Only possible while nobody has submitted work.
    function cancel() external onlyOrganizer nonReentrant {
        require(!cancelled && !finalized, "cannot cancel");
        require(_subs.length == 0, "submissions exist");
        cancelled = true;
        uint256 refund = funded ? totalPrize : 0;
        remainderWithdrawn = true;
        if (refund > 0) _pay(organizer, refund);
        emit Cancelled(refund);
    }

    // ───────────────────────────── participants ─────────────────────────────

    function join() external {
        require(phase() == Phase.Open, "not open");
        require(msg.sender != organizer && msg.sender != arbiter && !isJudge[msg.sender], "conflicted role");
        require(!isParticipant[msg.sender], "already joined");
        isParticipant[msg.sender] = true;
        _participants.push(msg.sender);
        emit Joined(msg.sender);
    }

    /// @notice Submit a repository link (or other permitted reference) plus a content hash.
    /// @param uri Reference (e.g. https://github.com/org/repo or ipfs://...)
    /// @param contentHash keccak256 of the commit hash / archive being submitted. Must be globally unique
    ///        within this competition, so the same work can't be entered twice by different wallets.
    function submit(string calldata uri, bytes32 contentHash) external returns (uint256 id) {
        require(phase() == Phase.Open, "not open");
        require(isParticipant[msg.sender], "join first");
        require(_subsOf[msg.sender].length < maxSubmissionsPerDev, "submission limit");
        require(contentHash != bytes32(0), "empty hash");
        require(!usedContentHash[contentHash], "duplicate submission");
        require(bytes(uri).length > 0 && bytes(uri).length <= 300, "bad uri");
        require(_subs.length < MAX_SUBMISSIONS, "competition full");

        usedContentHash[contentHash] = true;
        id = _subs.length;
        _subs.push(Submission(msg.sender, uint64(block.timestamp), false, 0, 0, contentHash, uri));
        _subsOf[msg.sender].push(id);
        emit Submitted(id, msg.sender, contentHash, uri);
    }

    // ───────────────────────────── judges ─────────────────────────────

    function addJudge(address judge) external onlyOrganizer {
        require(!cancelled && block.timestamp < deadline, "judge list locked");
        require(judge != address(0) && judge != organizer && judge != arbiter, "invalid judge");
        require(!isParticipant[judge], "judge is participant");
        require(!isJudge[judge], "already judge");
        require(_judges.length < MAX_JUDGES, "too many judges");
        isJudge[judge] = true;
        _judges.push(judge);
        emit JudgeAdded(judge);
    }

    function removeJudge(address judge) external onlyOrganizer {
        require(block.timestamp < deadline, "judge list locked");
        require(isJudge[judge], "not judge");
        isJudge[judge] = false;
        uint256 n = _judges.length;
        for (uint256 i = 0; i < n; i++) {
            if (_judges[i] == judge) {
                _judges[i] = _judges[n - 1];
                _judges.pop();
                break;
            }
        }
        emit JudgeRemoved(judge);
    }

    // ───────────────────────────── scoring ─────────────────────────────

    /// @notice Authorized judge records (or revises) a 0-100 score. Every call is logged,
    ///         giving an auditable review history.
    /// @param notesHash keccak256 of the judge's written evaluation, which they may publish off-chain.
    function score(uint256 id, uint8 s, bytes32 notesHash) external {
        require(isJudge[msg.sender], "not judge");
        require(funded && !cancelled, "inactive");
        require(block.timestamp >= deadline && block.timestamp < judgingEnd, "not judging window");
        require(s <= 100, "score > 100");
        require(id < _subs.length, "unknown submission");

        Submission storage sub = _subs[id];
        require(!sub.disqualified, "disqualified");

        Review storage r = _reviews[id][msg.sender];
        bool revised = r.exists;
        if (revised) {
            sub.scoreSum = sub.scoreSum - r.score + s;
        } else {
            sub.scoreSum += s;
            sub.judgeCount += 1;
            r.exists = true;
            if (sub.judgeCount == minJudgeScores) eligibleCount += 1;
        }
        r.score = s;
        r.notesHash = notesHash;
        emit ReviewSubmitted(id, msg.sender, s, notesHash, revised);
    }

    // ───────────────────────────── winner selection ─────────────────────────────

    /// @notice Approve winners. The caller supplies the ranking; the contract verifies it against
    ///         recorded judge scores (average desc, earlier submission, lower id) and reverts if it is
    ///         wrong. The organizer may call once judging closes; anyone may call after a grace period
    ///         so an absent organizer cannot freeze the competition.
    function finalize(uint256[] calldata ranked) external {
        require(funded && !cancelled, "inactive");
        require(block.timestamp >= judgingEnd, "judging ongoing");
        require(!finalized || needsReRank, "already finalized");
        require(msg.sender == organizer || block.timestamp >= finalizeDeadline, "not authorized");

        uint256 n = ranked.length;
        uint256 expected = eligibleCount < _prizes.length ? eligibleCount : _prizes.length;
        require(n == expected, "wrong winner count");
        if (n > 0) _verifyRanking(ranked);

        delete _winners;
        uint256 sum;
        for (uint256 i = 0; i < n; i++) {
            _winners.push(ranked[i]);
            sum += _prizes[i];
        }
        awarded = sum;

        bool rerank = finalized;
        if (!rerank) {
            finalized = true;
            disputeEnd = n == 0 ? uint64(block.timestamp) : uint64(block.timestamp) + disputeWindow;
        }
        needsReRank = false;
        emit WinnersFinalized(msg.sender, ranked, disputeEnd, rerank);
    }

    function _verifyRanking(uint256[] calldata ranked) private view {
        uint256 len = _subs.length;
        uint256 n = ranked.length;
        bool[] memory inList = new bool[](len);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = ranked[i];
            require(id < len && _eligible(id), "ineligible submission");
            if (i > 0) require(_better(ranked[i - 1], id), "bad order");
            inList[id] = true;
        }
        uint256 last = ranked[n - 1];
        for (uint256 id = 0; id < len; id++) {
            if (!inList[id] && _eligible(id)) require(_better(last, id), "omitted higher ranked");
        }
    }

    function _eligible(uint256 id) private view returns (bool) {
        Submission storage s = _subs[id];
        return !s.disqualified && s.judgeCount >= minJudgeScores;
    }

    /// @dev Strict total order: higher average, then earlier submission, then lower id.
    function _better(uint256 a, uint256 b) private view returns (bool) {
        Submission storage A = _subs[a];
        Submission storage B = _subs[b];
        uint256 l = uint256(A.scoreSum) * B.judgeCount;
        uint256 r = uint256(B.scoreSum) * A.judgeCount;
        if (l != r) return l > r;
        if (A.submittedAt != B.submittedAt) return A.submittedAt < B.submittedAt;
        return a < b;
    }

    // ───────────────────────────── disputes ─────────────────────────────

    /// @notice A participant contests a result (own score or another entry's validity).
    function raiseDispute(uint256 submissionId, string calldata evidenceURI) external returns (uint256 disputeId) {
        require(finalized && !cancelled && block.timestamp < disputeEnd, "dispute window closed");
        require(isParticipant[msg.sender], "participants only");
        require(submissionId < _subs.length, "unknown submission");
        require(disputesBy[msg.sender] < MAX_DISPUTES_PER_USER, "dispute limit");
        require(_disputes.length < MAX_DISPUTES, "too many disputes");
        require(bytes(evidenceURI).length > 0 && bytes(evidenceURI).length <= 300, "bad evidence");

        disputesBy[msg.sender] += 1;
        disputeId = _disputes.length;
        _disputes.push(Dispute(msg.sender, submissionId, DisputeStatus.Open, uint64(block.timestamp), evidenceURI));
        openDisputes += 1;
        emit DisputeRaised(disputeId, submissionId, msg.sender, evidenceURI);
    }

    /// @notice Arbiter (platform-appointed, independent of the organizer) resolves a dispute.
    /// @param uphold true to accept the dispute
    /// @param disqualifySubmission on uphold: disqualify the entry (e.g. plagiarism / rule breach)
    /// @param newScore on uphold without disqualification: replacement average score (0-100)
    function resolveDispute(uint256 disputeId, bool uphold, bool disqualifySubmission, uint8 newScore, bytes32 noteHash)
        external
        onlyArbiter
    {
        require(disputeId < _disputes.length, "unknown dispute");
        Dispute storage d = _disputes[disputeId];
        require(d.status == DisputeStatus.Open, "not open");
        require(!cancelled, "cancelled");

        d.status = uphold ? DisputeStatus.Upheld : DisputeStatus.Rejected;
        openDisputes -= 1;

        if (uphold) {
            if (disqualifySubmission) {
                _disqualify(d.submissionId, noteHash);
            } else {
                require(newScore <= 100, "score > 100");
                Submission storage s = _subs[d.submissionId];
                require(!s.disqualified && s.judgeCount > 0, "cannot adjust");
                s.scoreSum = uint32(newScore) * s.judgeCount;
                emit ScoreAdjusted(d.submissionId, newScore);
            }
            _flagReRank();
        }
        emit DisputeResolved(disputeId, d.status, uphold && disqualifySubmission, newScore, noteHash);
    }

    /// @notice If the arbiter is unresponsive, anyone can close a stale dispute as Expired
    ///         so prizes are never frozen forever.
    function expireDispute(uint256 disputeId) external {
        require(disputeId < _disputes.length, "unknown dispute");
        Dispute storage d = _disputes[disputeId];
        require(d.status == DisputeStatus.Open, "not open");
        require(block.timestamp >= disputeEnd + ARBITER_TIMEOUT, "arbiter timeout not reached");
        d.status = DisputeStatus.Expired;
        openDisputes -= 1;
        emit DisputeResolved(disputeId, DisputeStatus.Expired, false, 0, bytes32(0));
    }

    /// @notice Arbiter-only disqualification (plagiarism, rule violations) before prizes are claimable.
    function disqualify(uint256 id, bytes32 reasonHash) external onlyArbiter {
        require(funded && !cancelled && block.timestamp >= deadline, "not allowed yet");
        require(!claimsOpen(), "claims open");
        require(id < _subs.length && !_subs[id].disqualified, "invalid submission");
        _disqualify(id, reasonHash);
        _flagReRank();
    }

    function _disqualify(uint256 id, bytes32 reasonHash) private {
        if (_eligible(id)) eligibleCount -= 1;
        _subs[id].disqualified = true;
        emit Disqualified(id, reasonHash);
    }

    function _flagReRank() private {
        if (finalized) {
            needsReRank = true;
            finalizeDeadline = uint64(block.timestamp) + FINALIZE_GRACE;
        }
    }

    // ───────────────────────────── claims & refunds ─────────────────────────────

    function claimsOpen() public view returns (bool) {
        return finalized && !cancelled && !needsReRank && openDisputes == 0 && block.timestamp >= disputeEnd;
    }

    /// @notice Winner pulls their prize. One claim per rank; only the submission's author can claim.
    function claimPrize(uint256 rank) external nonReentrant {
        require(claimsOpen(), "claims not open");
        require(rank < _winners.length, "no such rank");
        require(!prizeClaimed[rank], "already claimed");
        require(_subs[_winners[rank]].dev == msg.sender, "not winner");
        prizeClaimed[rank] = true;
        uint256 amount = _prizes[rank];
        _pay(msg.sender, amount);
        emit PrizeClaimed(rank, msg.sender, amount);
    }

    /// @notice Organizer reclaims anything not awarded (fewer eligible entries than prizes,
    ///         or no eligible entries at all) once claims are open.
    function withdrawRemainder() external onlyOrganizer nonReentrant {
        require(claimsOpen(), "claims not open");
        require(!remainderWithdrawn, "already withdrawn");
        remainderWithdrawn = true;
        uint256 amount = totalPrize - awarded;
        require(amount > 0, "nothing to withdraw");
        _pay(organizer, amount);
        emit RemainderWithdrawn(organizer, amount);
    }

    function _pay(address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "native transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ───────────────────────────── views ─────────────────────────────

    function phase() public view returns (Phase) {
        if (cancelled) return Phase.Cancelled;
        if (!funded) return Phase.Unfunded;
        if (block.timestamp < deadline) return Phase.Open;
        if (!finalized) return block.timestamp < judgingEnd ? Phase.Judging : Phase.AwaitingFinalization;
        return claimsOpen() ? Phase.Completed : Phase.DisputeWindow;
    }

    function info() external view returns (Info memory i) {
        i.organizer = organizer;
        i.arbiter = arbiter;
        i.token = token;
        i.title = title;
        i.description = description;
        i.requirements = requirements;
        i.difficulty = difficulty;
        i.deadline = deadline;
        i.judgingEnd = judgingEnd;
        i.disputeEnd = disputeEnd;
        i.disputeWindow = disputeWindow;
        i.minJudgeScores = minJudgeScores;
        i.maxSubmissionsPerDev = maxSubmissionsPerDev;
        i.totalPrize = totalPrize;
        i.prizes = _prizes;
        i.phase = phase();
        i.submissionCount = _subs.length;
        i.participantCount = _participants.length;
        i.eligibleCount = eligibleCount;
        i.openDisputes = openDisputes;
        i.funded = funded;
        i.needsReRank = needsReRank;
    }

    function getSubmission(uint256 id) external view returns (Submission memory) {
        return _subs[id];
    }

    function reviewOf(uint256 id, address judge) external view returns (Review memory) {
        return _reviews[id][judge];
    }

    function submissionsOf(address dev) external view returns (uint256[] memory) {
        return _subsOf[dev];
    }

    function judges() external view returns (address[] memory) {
        return _judges;
    }

    function participants() external view returns (address[] memory) {
        return _participants;
    }

    function winners() external view returns (uint256[] memory) {
        return _winners;
    }

    function prizes() external view returns (uint256[] memory) {
        return _prizes;
    }

    function disputeCount() external view returns (uint256) {
        return _disputes.length;
    }

    function getDispute(uint256 id) external view returns (Dispute memory) {
        return _disputes[id];
    }
}
