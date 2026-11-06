// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OrganizerRegistry
/// @notice Public registry of organizations that may publish challenges.
///         Registration is permissionless; the owner can only attach a "verified" badge,
///         which is informational and never gates funds.
contract OrganizerRegistry {
    struct Profile {
        string name;
        string website;
        string description;
        uint64 registeredAt;
        bool verified;
        bool exists;
    }

    address public owner;
    address[] private _organizers;
    mapping(address => Profile) private _profiles;

    event OrganizerRegistered(address indexed organizer, string name);
    event OrganizerUpdated(address indexed organizer, string name);
    event OrganizerVerified(address indexed organizer, bool verified);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function register(string calldata name, string calldata website, string calldata description) external {
        require(!_profiles[msg.sender].exists, "already registered");
        _validate(name, website, description);
        _profiles[msg.sender] = Profile(name, website, description, uint64(block.timestamp), false, true);
        _organizers.push(msg.sender);
        emit OrganizerRegistered(msg.sender, name);
    }

    function update(string calldata name, string calldata website, string calldata description) external {
        Profile storage p = _profiles[msg.sender];
        require(p.exists, "not registered");
        _validate(name, website, description);
        p.name = name;
        p.website = website;
        p.description = description;
        emit OrganizerUpdated(msg.sender, name);
    }

    function setVerified(address organizer, bool verified) external onlyOwner {
        require(_profiles[organizer].exists, "not registered");
        _profiles[organizer].verified = verified;
        emit OrganizerVerified(organizer, verified);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function isRegistered(address organizer) external view returns (bool) {
        return _profiles[organizer].exists;
    }

    function getProfile(address organizer) external view returns (Profile memory) {
        return _profiles[organizer];
    }

    function organizerCount() external view returns (uint256) {
        return _organizers.length;
    }

    function organizerAt(uint256 index) external view returns (address) {
        return _organizers[index];
    }

    function _validate(string calldata name, string calldata website, string calldata description) private pure {
        require(bytes(name).length > 0 && bytes(name).length <= 80, "bad name");
        require(bytes(website).length <= 200, "website too long");
        require(bytes(description).length <= 500, "description too long");
    }
}
