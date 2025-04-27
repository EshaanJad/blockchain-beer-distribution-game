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
const { runPolicy } = require("./policies/runPolicy");
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

// New diagnostic function to check the demand pattern
async function checkDemandPattern(gameContract) {
  console.log("\n===== DEMAND PATTERN DIAGNOSTIC =====");
  try {
    // Get the selected demand pattern
    const selectedDemandPattern = await gameContract.selectedDemandPattern();
    const patternNames = ["CONSTANT", "STEP_INCREASE", "RANDOM", "CUSTOM"];
    console.log(`Selected demand pattern: ${patternNames[selectedDemandPattern]} (${selectedDemandPattern})`);
    
    // Get all customer demand values
    const customerDemand = await gameContract.getCustomerDemand();
    const demandValues = customerDemand.map(d => parseInt(d.toString()));
    
    // Check first 10 values (or less if fewer are available)
    const samplesToCheck = Math.min(10, demandValues.length);
    console.log(`Demand values (first ${samplesToCheck}): ${demandValues.slice(0, samplesToCheck).join(', ')}...`);
    
    // Check if values are constant
    let isActuallyConstant = true;
    if (demandValues.length > 1) {
      const firstValue = demandValues[0];
      isActuallyConstant = demandValues.every(d => d === firstValue);
    }
    console.log(`Demand appears to be ${isActuallyConstant ? 'CONSTANT' : 'VARIABLE'} based on actual values`);
    
    // Calculate statistics if variable
    if (!isActuallyConstant) {
      const sum = demandValues.reduce((a, b) => a + b, 0);
      const avg = sum / demandValues.length;
      const sumSquaredDiff = demandValues.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0);
      const stdDev = Math.sqrt(sumSquaredDiff / demandValues.length);
      
      console.log(`Demand statistics: Avg=${avg.toFixed(2)}, StdDev=${stdDev.toFixed(2)}, CV=${(stdDev/avg).toFixed(2)}`);
      
      // Check if this conflicts with the selected pattern
      if (selectedDemandPattern === 0) { // CONSTANT
        console.log("WARNING: Demand pattern is set to CONSTANT but actual values vary!");
      }
    }
  } catch (error) {
    console.error("Error in demand pattern diagnostic:", error);
  }
  console.log("=======================================\n");
}

// Function to save simulation results for visualization
async function saveDataForVisualization(traditionalResults, blockchainResults, demandPattern) {
  // Determine file suffix based on demand pattern
  let patternSuffix = "random";
  if (demandPattern === 0) patternSuffix = "constant";
  else if (demandPattern === 1) patternSuffix = "step";
  
  // Save traditional data
  const traditionalDataPath = path.join(__dirname, `../visualization/data_traditional_${patternSuffix}.json`);
  try {
    fs.writeFileSync(traditionalDataPath, JSON.stringify(traditionalResults.weeklyData, null, 2));
    console.log(`Traditional simulation data saved to ${traditionalDataPath}`);
  } catch (err) {
    console.error("Error saving traditional data:", err);
  }
  
  // Save blockchain data
  const blockchainDataPath = path.join(__dirname, `../visualization/data_blockchain_${patternSuffix}.json`);
  try {
    fs.writeFileSync(blockchainDataPath, JSON.stringify(blockchainResults.weeklyData, null, 2));
    console.log(`Blockchain simulation data saved to ${blockchainDataPath}`);
  } catch (err) {
    console.error("Error saving blockchain data:", err);
  }
}

async function main() {
    try {
        // Get signers for testing
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        
        console.log("Running Beer Distribution Game with policies");
        console.log("Owner:", owner.address);
        console.log(`Retailer: ${retailer.address}`);
        console.log(`Wholesaler: ${wholesaler.address}`);
        console.log(`Distributor: ${distributor.address}`);
        console.log(`Factory: ${factory.address}\n`);
        
        // Get contract deployment
        const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
        
        // Define DemandPattern enum values (assuming they are 0, 1, 2 in the contract)
        const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2 };

        // Set demand pattern for simulation (both use the same pattern)
        const demandPattern = DemandPattern.RANDOM; // Change to RANDOM to see the impact of visibility
        
        // --- Traditional Game Setup ---
        console.log("\nRunning traditional simulation...");
        const traditionalGame = await BeerDistributionGame.deploy();
        await traditionalGame.initializeGame(demandPattern);
        
        // Run diagnostic to verify demand pattern
        console.log("\nTraditional Game Demand Pattern:");
        await checkDemandPattern(traditionalGame);
        
        // Run traditional (non-blockchain) simulation
        const traditionalResults = await runPolicy.runGameWithPolicy(
            traditionalGame,
            [retailer, wholesaler, distributor, factory],
            false, // No blockchain visibility
            demandPattern,
            52 // Weeks to run
        );
        
        console.log("\nRunning blockchain-enabled simulation...");
        const blockchainGame = await BeerDistributionGame.deploy();
        await blockchainGame.initializeGame(demandPattern);
        
        // Run diagnostic to verify demand pattern
        console.log("\nBlockchain Game Demand Pattern:");
        await checkDemandPattern(blockchainGame);
        
        // Run blockchain-enabled simulation
        const blockchainResults = await runPolicy.runGameWithPolicy(
            blockchainGame,
            [retailer, wholesaler, distributor, factory],
            true, // With blockchain visibility
            demandPattern,
            52 // Weeks to run
        );
        
        // Convert BigInt values to numbers for consistent handling
        const tradCost = Number(traditionalResults.finalCost);
        const blockCost = Number(blockchainResults.finalCost);
        
        console.log("\n=== FINAL RESULTS ===");
        console.log(`Traditional Game Total Cost: ${tradCost}`);
        console.log(`Blockchain Game Total Cost: ${blockCost}`);
        
        // Save the data for visualization
        await saveDataForVisualization(traditionalResults, blockchainResults, demandPattern);
        
        // Compare results
        if (blockCost < tradCost) {
            const reduction = tradCost - blockCost;
            const percentReduction = (reduction / tradCost) * 100;
            console.log(`\nBlockchain-enabled approach achieved a cost reduction of ${reduction} (${percentReduction.toFixed(2)}%)`);
        } else if (tradCost < blockCost) {
            const increase = blockCost - tradCost;
            const percentIncrease = (increase / tradCost) * 100;
            console.log(`\nBlockchain-enabled approach resulted in a cost increase of ${increase} (${percentIncrease.toFixed(2)}%)`);
        } else {
            console.log("\nConclusion: Both approaches resulted in the same total costs.");
            console.log("This suggests that the visibility provided by blockchain didn't affect the outcome.");
        }
    } catch (error) {
        console.error("Error in main function:", error);
        process.exit(1);
    }
}

// Execute the comparison
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 