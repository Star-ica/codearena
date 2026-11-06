// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Challenge} from "./Challenge.sol";
import {OrganizerRegistry} from "./OrganizerRegistry.sol";

/// @title ChallengeFactory
/// @notice Deploys one isolated Challenge (escrow + registry + scoring) per competition.
///         Only registered organizers can publish; only allow-listed prize tokens are accepted.
///         address(0) represents the chain's native currency.
contract ChallengeFactory {
    OrganizerRegistry public immutable registry;
    address public owner;
    address public arbiter;

    mapping(address => bool) public tokenAllowed;
    address[] private _all;
    mapping(address => address[]) private _byOrganizer;

    event ChallengeCreated(address indexed challenge, address indexed organizer, address token, uint256 totalPrize, uint64 deadline);
    event TokenAllowed(address indexed token, bool allowed);
    event ArbiterChanged(address indexed arbiter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(OrganizerRegistry _registry, address _arbiter) {
        require(address(_registry) != address(0) && _arbiter != address(0), "zero address");
        registry = _registry;
        arbiter = _arbiter;
        owner = msg.sender;
        tokenAllowed[address(0)] = true;
        emit TokenAllowed(address(0), true);
    }

    function createChallenge(Challenge.Params memory p) external returns (address challenge) {
        require(registry.isRegistered(msg.sender), "register organization first");
        require(tokenAllowed[p.token], "token not allowed");
        Challenge c = new Challenge(msg.sender, arbiter, p);
        challenge = address(c);
        _all.push(challenge);
        _byOrganizer[msg.sender].push(challenge);
        emit ChallengeCreated(challenge, msg.sender, p.token, c.totalPrize(), p.deadline);
    }

    function allChallenges() external view returns (address[] memory) {
        return _all;
    }

    function challengeCount() external view returns (uint256) {
        return _all.length;
    }

    function challengesByOrganizer(address organizer) external view returns (address[] memory) {
        return _byOrganizer[organizer];
    }

    // ── admin (cannot touch escrowed funds; only affects future challenges) ──
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setArbiter(address newArbiter) external onlyOwner {
        require(newArbiter != address(0), "zero address");
        arbiter = newArbiter;
        emit ArbiterChanged(newArbiter);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
