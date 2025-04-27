/**
 * Main Simulation Script for Beer Distribution Game
 * 
 * This script is the primary entry point for running the beer distribution game simulation.
 * It compares the performance of the same ordering policy with and without
 * blockchain visibility to demonstrate the value of full supply chain visibility.
 * 
 * Results are saved to the visualization directory for analysis and visualization.
 */

const { ethers } = require("hardhat");
const { runGameWithPolicy } = require("./policies/runPolicy");
const fs = require('fs'); // Import file system module
const path = require('path'); // Import path module

/**
 * Convert a BigInt to a number for calculation
 * @param {BigInt|number} value - The value to convert
 */
function toNumber(value) {
    if (typeof value === 'bigint') {
        return Number(value);
    }
    return Number(value);
}

async function main() {
    console.log("Starting Beer Distribution Game Policy Comparison");
    console.log("=================================================\n");
    
    // Get signers for different roles
    const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
    
    console.log("Using accounts:");
    console.log(`Owner: ${owner.address}`);
    console.log(`Retailer: ${retailer.address}`);
    console.log(`Wholesaler: ${wholesaler.address}`);
    console.log(`Distributor: ${distributor.address}`);
    console.log(`Factory: ${factory.address}\n`);
    
    // Deploy a fresh contract for each test
    const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
    
    // Define DemandPattern enum values (assuming they are 0, 1, 2 in the contract)
    const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2 };

    // --- Traditional Game Setup ---
    console.log("Running traditional game (without blockchain visibility, using RANDOM demand)...");
    const traditionalGame = await BeerDistributionGame.deploy();

    // Run simulation without blockchain visibility - Pass DemandPattern.RANDOM
    const traditionalResult = await runGameWithPolicy(
        traditionalGame,
        [retailer, wholesaler, distributor, factory],
        false, // No blockchain visibility
        DemandPattern.RANDOM, // Specify RANDOM demand
        52 // 52 weeks
    );
    const traditionalCost = traditionalResult.finalCost;
    const traditionalData = traditionalResult.weeklyData;

    // Save traditional data to JSON (path to root visualization folder)
    const traditionalDataPath = path.join(__dirname, '../visualization/data_traditional_random.json');
    try {
        fs.writeFileSync(traditionalDataPath, JSON.stringify(traditionalData, null, 2));
        console.log(`Traditional simulation data saved to ${traditionalDataPath}`);
    } catch (err) {
        console.error("Error saving traditional data:", err);
    }
    
    // --- Blockchain Game Setup ---
    console.log("\n\nRunning blockchain-enabled game (with full visibility, using RANDOM demand)...");
    const blockchainGame = await BeerDistributionGame.deploy();

    // Run simulation with blockchain visibility - Pass DemandPattern.RANDOM
    const blockchainResult = await runGameWithPolicy(
        blockchainGame,
        [retailer, wholesaler, distributor, factory],
        true, // With blockchain visibility
        DemandPattern.RANDOM, // Specify RANDOM demand
        52 // 52 weeks
    );
    const blockchainCost = blockchainResult.finalCost;
    const blockchainData = blockchainResult.weeklyData;

    // Save blockchain data to JSON (path to root visualization folder)
    const blockchainDataPath = path.join(__dirname, '../visualization/data_blockchain_random.json');
    try {
        fs.writeFileSync(blockchainDataPath, JSON.stringify(blockchainData, null, 2));
        console.log(`Blockchain simulation data saved to ${blockchainDataPath}`);
    } catch (err) {
        console.error("Error saving blockchain data:", err);
    }
    
    // Convert costs to numbers for calculations if they're BigInts
    const traditionalCostNum = toNumber(traditionalCost);
    const blockchainCostNum = toNumber(blockchainCost);
    
    // Compare results
    console.log("\n\nResults Comparison");
    console.log("=================");
    console.log(`Traditional game total cost: ${traditionalCost.toString()}`);
    console.log(`Blockchain-enabled game total cost: ${blockchainCost.toString()}`);
    
    // Calculate cost reduction as numbers rather than BigInts
    const costReduction = traditionalCostNum - blockchainCostNum;
    const costReductionPercent = traditionalCostNum > 0 ? 
        (costReduction * 100) / traditionalCostNum : 0;
    
    console.log(`\nCost reduction with blockchain: ${costReduction} (${costReductionPercent.toFixed(2)}%)`);
    
    if (blockchainCostNum < traditionalCostNum) {
        console.log("\nConclusion: The blockchain-enabled approach with full visibility resulted in LOWER total costs.");
    } else if (blockchainCostNum > traditionalCostNum) {
        console.log("\nConclusion: The blockchain-enabled approach with full visibility resulted in HIGHER total costs.");
        console.log("This is unexpected and may indicate that the ordering policy needs refinement.");
    } else {
        console.log("\nConclusion: Both approaches resulted in the same total costs.");
        console.log("This suggests that the visibility provided by blockchain didn't affect the outcome.");
    }
}

// Execute the comparison
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 