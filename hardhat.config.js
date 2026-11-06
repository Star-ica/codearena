require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { RPC_URL, DEPLOYER_KEY, CHAIN_ID } = process.env;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "paris" },
  },
  networks: {
    hardhat: { allowUnlimitedContractSize: false },
    // Any EVM chain (BOT network, testnet, etc.): set RPC_URL, DEPLOYER_KEY, CHAIN_ID in .env
    target: RPC_URL
      ? { url: RPC_URL, chainId: Number(CHAIN_ID || 0) || undefined, accounts: DEPLOYER_KEY ? [DEPLOYER_KEY] : [] }
      : { url: "http://127.0.0.1:8545" },
  },
};
