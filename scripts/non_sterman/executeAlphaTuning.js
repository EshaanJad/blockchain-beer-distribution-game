/**
 * Execute Alpha Parameter Tuning for Beer Distribution Game
 * 
 * This script performs a systematic sensitivity analysis (grid search) on the 
 * blockchain-specific alpha adjustment parameters (THRESHOLD_HIGH and MIN_ALPHA).
 * It runs the blockchain-enabled simulation multiple times, iterating through 
 * predefined ranges for the parameters and recording the final totalCost.
 */

const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const blockchainTuning = require('./runBlockchainTuning');

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

/**
 * Read order flow data from CSV file
 * @param {string} filePath - Path to CSV file
 * @returns {Promise<Array>} - Array of demand values
 */
async function readOrderFlowData(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        
        // Create readable stream from CSV file
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                // Extract customer demand from "Customer → FL Orders ($)" column
                const customerDemand = parseFloat(data['Customer → FL Orders ($)']);
                
                // Only push valid numbers - use values directly, no scaling needed for forecasted data
                if (!isNaN(customerDemand)) {
                    results.push(customerDemand);
                }
            })
            .on('end', () => {
                if (results.length === 0) {
                    reject(new Error('No valid demand data found in CSV'));
                } else {
                    console.log(`Read ${results.length} demand data points from CSV`);
                    console.log(`Demand values (first 5): ${results.slice(0, 5).join(', ')}...`);
                    resolve(results);
                }
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

/**
 * Main function to execute the parameter tuning
 */
async function main() {
    try {
        console.log("Starting Blockchain Parameter Tuning for Forecasted Data");
        console.log("=======================================\n");
        
        // Define parameter ranges to test
        const thresholdHighValues = [0.75, 0.9, 1.15, 1.3];
        const minAlphaValues = [0.2, 0.4, 0.6, 0.8];
        
        // Initialize results array
        const results = [];
        
        // Get signers for roles
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        const signers = [retailer, wholesaler, distributor, factory];
        
        console.log("Using accounts:");
        console.log(`Owner: ${owner.address}`);
        console.log(`Retailer: ${retailer.address}`);
        console.log(`Wholesaler: ${wholesaler.address}`);
        console.log(`Distributor: ${distributor.address}`);
        console.log(`Factory: ${factory.address}\n`);
        
        // Read customer demand data from CSV - use forecasted data
        const csvFilePath = path.join(__dirname, '../Forecasted-Crox-Data.csv');
        let customerDemandData;
        
        try {
            customerDemandData = await readOrderFlowData(csvFilePath);
            console.log("Successfully loaded customer demand data from Forecasted-Crox-Data.csv");
            
            // Calculate statistics for the customer demand data
            if (customerDemandData.length > 1) {
                const sum = customerDemandData.reduce((a, b) => a + b, 0);
                const avg = sum / customerDemandData.length;
                const sumSquaredDiff = customerDemandData.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0);
                const stdDev = Math.sqrt(sumSquaredDiff / customerDemandData.length);
                
                console.log(`CSV Demand statistics: Avg=${avg.toFixed(2)}, StdDev=${stdDev.toFixed(2)}, CV=${(stdDev/avg).toFixed(2)}`);
            }
        } catch (error) {
            console.error("Error reading CSV file:", error);
            console.log("Cannot proceed without customer demand data");
            process.exit(1);
        }
        
        // Define the periods to run (use reasonable number of periods)
        const periods = Math.min(customerDemandData.length, 30);
        console.log(`Using ${periods} periods for each simulation run`);
        
        // Create results CSV file with timestamp to avoid overwriting
        const timestamp = new Date().getTime();
        const resultsPath = path.join(__dirname, `../visualization/forecasted_alpha_tuning_results_${timestamp}.csv`);
        fs.writeFileSync(resultsPath, 'ThresholdHigh,MinAlpha,TotalCost\n');
        
        // Iterate through all parameter combinations
        for (const thValue of thresholdHighValues) {
            for (const maValue of minAlphaValues) {
                console.log(`\n===================================================`);
                console.log(`Running simulation with TH=${thValue}, MA=${maValue}`);
                console.log(`===================================================`);
                
                // Create tuning parameters object
                const tuningParams = {
                    thresholdHigh: thValue,
                    minAlpha: maValue
                };
                
                // Deploy a fresh contract for each run to ensure clean state
                const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
                const game = await BeerDistributionGame.deploy();
                
                // Set initial inventory to 40 (increased from default 8)
                await game.setInitialInventory(40);
                console.log(`Initial inventory set to 40 units for all supply chain members`);
                
                // Define DemandPattern enum values
                const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
                
                // Set custom demand data in the contract
                const tx = await game.setCustomDemandPattern(customerDemandData.slice(0, periods));
                await tx.wait();
                console.log(`Custom demand pattern set for ${periods} periods`);
                
                // Run the simulation with the current parameter values
                const simulationResult = await blockchainTuning.runGameWithPolicy(
                    game,
                    signers,
                    DemandPattern.CUSTOM,
                    periods,
                    tuningParams
                );
                
                // Get the final cost
                const totalCost = toNumber(simulationResult.finalCost);
                
                // Add result to results array
                results.push({
                    thresholdHigh: thValue,
                    minAlpha: maValue,
                    totalCost: totalCost
                });
                
                // Append to CSV
                fs.appendFileSync(resultsPath, `${thValue},${maValue},${totalCost}\n`);
                
                console.log(`Completed run with TH=${thValue}, MA=${maValue}, Total Cost=${totalCost}`);
            }
        }
        
        // Write full results to JSON file for additional analysis
        const jsonResultsPath = path.join(__dirname, `../visualization/forecasted_alpha_tuning_results_${timestamp}.json`);
        fs.writeFileSync(jsonResultsPath, JSON.stringify(results, null, 2));
        
        // Find best parameter combination (lowest cost)
        const bestResult = results.reduce((best, current) => 
            current.totalCost < best.totalCost ? current : best, results[0]);
        
        console.log("\n=============================================================");
        console.log("Forecasted Data Parameter Tuning Complete");
        console.log("=============================================================");
        console.log(`Total parameter combinations tested: ${results.length}`);
        console.log(`Results saved to: ${resultsPath}`);
        console.log(`Full JSON results saved to: ${jsonResultsPath}`);
        console.log("\nBest Parameter Combination:");
        console.log(`ThresholdHigh: ${bestResult.thresholdHigh}`);
        console.log(`MinAlpha: ${bestResult.minAlpha}`);
        console.log(`Total Cost: ${bestResult.totalCost}`);
        
        // Print results table
        console.log("\nResults Summary Table:");
        console.log("ThresholdHigh | MinAlpha | Total Cost");
        console.log("-------------|---------|------------");
        
        results.forEach(r => {
            console.log(
                `${r.thresholdHigh.toString().padEnd(13)} | ` +
                `${r.minAlpha.toString().padEnd(9)} | ` +
                `${r.totalCost.toString()}`
            );
        });
        
    } catch (error) {
        console.error("Error in main function:", error);
        process.exit(1);
    }
}

// Execute the parameter tuning
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 