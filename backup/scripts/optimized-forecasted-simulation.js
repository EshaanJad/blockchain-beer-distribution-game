/**
 * Optimized Forecasted Crocs Supply Chain Simulation Script
 * 
 * This script runs the beer distribution game simulation using forecasted order flow data
 * with optimized blockchain parameters (ThresholdHigh=0.9, MinAlpha=0.8) that were
 * determined through parameter tuning to be optimal for this forecasted dataset.
 * 
 * Results are saved to the visualization directory for analysis and visualization.
 */

const { ethers } = require("hardhat");
const runPolicy = require("./policies/runPolicy");
const fs = require('fs'); // Import file system module
const path = require('path'); // Import path module
const csv = require('csv-parser'); // Add this dependency for CSV parsing

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
 * Check the demand pattern from the game contract
 * @param {Contract} gameContract - The BeerDistributionGame contract
 */
async function checkDemandPattern(gameContract) {
    try {
        // Get how many customer demands are set
        const demandCount = await gameContract.getCustomerDemandCount();
        console.log(`Customer demand count: ${toNumber(demandCount)}`);

        // Check if the pattern is constant or variable
        let isConstant = true;
        let previousDemand = null;
        
        // Display first 10 weeks of demand for inspection
        console.log("Demand pattern for first 10 weeks:");
        for (let i = 0; i < Math.min(10, toNumber(demandCount)); i++) {
            const demand = await gameContract.getCustomerDemandForWeek(i);
            console.log(`Week ${i}: ${toNumber(demand)}`);
            
            if (previousDemand !== null && toNumber(demand) !== previousDemand) {
                isConstant = false;
            }
            previousDemand = toNumber(demand);
        }
        
        console.log(`Demand pattern is ${isConstant ? 'constant' : 'variable'}`);
        
        // Calculate statistics if variable
        if (!isConstant) {
            let sum = 0;
            let values = [];
            
            for (let i = 0; i < Math.min(20, toNumber(demandCount)); i++) {
                const demand = await gameContract.getCustomerDemandForWeek(i);
                const demandNum = toNumber(demand);
                sum += demandNum;
                values.push(demandNum);
            }
            
            const avg = sum / values.length;
            const variance = values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);
            
            console.log(`Average demand (first ${values.length} weeks): ${avg.toFixed(2)}`);
            console.log(`Standard deviation: ${stdDev.toFixed(2)}`);
            console.log(`Coefficient of variation: ${(stdDev / avg).toFixed(2)}`);
        }
    } catch (error) {
        console.error("Error checking demand pattern:", error);
    }
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
                // Extract customer demand from the correct column
                const customerDemand = parseInt(data['Customer → FL Orders ($)'] || 0);
                
                // Make sure we have a valid number
                if (!isNaN(customerDemand) && customerDemand >= 0) {
                    results.push(customerDemand);
                }
            })
            .on('end', () => {
                console.log(`Read ${results.length} weeks of order flow data`);
                console.log(`Sample demand values (first 5): ${results.slice(0, 5).join(', ')}`);
                resolve(results);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

/**
 * Run a single simulation with specified number of periods
 * @param {Array} customerDemandData - Full array of demand data
 * @param {number} periods - Number of periods to simulate
 * @param {boolean} useBlockchain - Whether to use blockchain visibility
 * @param {string} label - Label for the simulation (for file naming)
 * @param {Object} blockchainParams - Optional parameters for blockchain simulation tuning
 */
async function runSimulation(customerDemandData, periods, useBlockchain, label, blockchainParams = null) {
    console.log(`\n\nRunning ${useBlockchain ? 'blockchain-enabled' : 'traditional'} game for ${periods} periods...`);
    
    if (useBlockchain && blockchainParams) {
        console.log(`Using optimized blockchain parameters: ThresholdHigh=${blockchainParams.thresholdHigh}, MinAlpha=${blockchainParams.minAlpha}`);
    }
    
    // Get signers for different roles
    const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
    
    // Deploy a fresh contract
    const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
    console.log("Deploying BeerDistributionGame contract...");
    const game = await BeerDistributionGame.deploy();
    console.log(`BeerDistributionGame deployed to: ${game.address}`);
    
    // Set initial inventory to 40 (increased from default 8)
    const setInventoryTx = await game.setInitialInventory(40);
    await setInventoryTx.wait();
    console.log(`Initial inventory set to 40 units for all supply chain members`);
    
    // Define DemandPattern enum values
    const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
    
    // Use only the needed periods from the demand data
    const limitedDemandData = customerDemandData.slice(0, periods);
    
    // Set custom demand data in the contract
    console.log(`Setting custom demand pattern with ${limitedDemandData.length} values: ${limitedDemandData.slice(0, 5).join(', ')}...`);
    const tx = await game.setCustomDemandPattern(limitedDemandData);
    await tx.wait();
    console.log(`Custom demand pattern set for ${periods} periods`);
    
    // Run simulation with optimized parameters if using blockchain
    let result;
    if (useBlockchain && blockchainParams) {
        // Pass the blockchain parameters to the runGameWithPolicyAndParams function
        result = await runPolicy.runGameWithPolicyAndParams(
            game,
            [retailer, wholesaler, distributor, factory],
            useBlockchain,
            DemandPattern.CUSTOM,
            periods,
            blockchainParams
        );
    } else {
        // Use the standard function for traditional simulation
        result = await runPolicy.runGameWithPolicy(
            game,
            [retailer, wholesaler, distributor, factory],
            useBlockchain,
            DemandPattern.CUSTOM,
            periods
        );
    }
    
    const totalCost = result.finalCost;
    const weeklyData = result.weeklyData;
    
    // Save data to JSON - ensure we create the directory structure if needed
    const visibilityLabel = useBlockchain ? (blockchainParams ? 'blockchain_optimized' : 'blockchain') : 'traditional';
    const dataDir = path.join(__dirname, '../visualization/data/simulations/forecasted');
    const dataPath = path.join(dataDir, `data_${visibilityLabel}_forecasted_crocs_${periods}_periods.json`);
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    try {
        fs.writeFileSync(dataPath, JSON.stringify(weeklyData, null, 2));
        console.log(`Simulation data saved to ${dataPath}`);
    } catch (err) {
        console.error(`Error saving ${visibilityLabel} data:`, err);
    }
    
    return {
        totalCost: toNumber(totalCost),
        weeklyData
    };
}

async function main() {
    try {
        console.log("Starting Optimized Forecasted Crocs Supply Chain Simulations");
        console.log("=================================================\n");
        
        // Get signers for reference
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        
        console.log("Using accounts:");
        console.log(`Owner: ${owner.address}`);
        console.log(`Retailer: ${retailer.address}`);
        console.log(`Wholesaler: ${wholesaler.address}`);
        console.log(`Distributor: ${distributor.address}`);
        console.log(`Factory: ${factory.address}\n`);
        
        // Read customer demand data from CSV
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
        
        // Run simulations with the full number of periods in the forecasted data
        const maxPeriods = customerDemandData.length;
        
        // Create summary file
        const summaryPath = path.join(__dirname, '../visualization/optimized_forecasted_simulation_summary.csv');
        fs.writeFileSync(summaryPath, 'Periods,TraditionalCost,BlockchainCost,OptimizedBlockchainCost,CostReduction,OptimizedCostReduction,CostReductionPercent,OptimizedCostReductionPercent\n');
        
        console.log(`\n\n==========================================`);
        console.log(`SIMULATION WITH ${maxPeriods} PERIODS (full forecasted data)`);
        console.log(`==========================================`);
        
        // Define optimized blockchain parameters
        const optimizedParams = {
            thresholdHigh: 0.9,
            minAlpha: 0.8
        };
        
        // Run traditional simulation
        const traditionalResult = await runSimulation(
            customerDemandData, 
            maxPeriods, 
            false, // No blockchain visibility
            `traditional_forecasted_${maxPeriods}`
        );
        
        // Run standard blockchain simulation
        const blockchainResult = await runSimulation(
            customerDemandData, 
            maxPeriods, 
            true, // With blockchain visibility
            `blockchain_forecasted_${maxPeriods}`
        );
        
        // Run optimized blockchain simulation
        const optimizedBlockchainResult = await runSimulation(
            customerDemandData, 
            maxPeriods, 
            true, // With blockchain visibility
            `blockchain_optimized_forecasted_${maxPeriods}`,
            optimizedParams // Pass the optimized parameters
        );
        
        // Calculate cost reductions
        const traditionalCost = traditionalResult.totalCost;
        const blockchainCost = blockchainResult.totalCost;
        const optimizedBlockchainCost = optimizedBlockchainResult.totalCost;
        
        const costReduction = traditionalCost - blockchainCost;
        const optimizedCostReduction = traditionalCost - optimizedBlockchainCost;
        
        const costReductionPercent = traditionalCost > 0 ? 
            (costReduction * 100) / traditionalCost : 0;
        const optimizedCostReductionPercent = traditionalCost > 0 ?
            (optimizedCostReduction * 100) / traditionalCost : 0;
        
        // Store results
        const results = {
            periods: maxPeriods,
            traditionalCost,
            blockchainCost,
            optimizedBlockchainCost,
            costReduction,
            optimizedCostReduction,
            costReductionPercent,
            optimizedCostReductionPercent
        };
        
        // Append to summary CSV
        fs.appendFileSync(
            summaryPath, 
            `${maxPeriods},${traditionalCost},${blockchainCost},${optimizedBlockchainCost},${costReduction},${optimizedCostReduction},${costReductionPercent.toFixed(2)},${optimizedCostReductionPercent.toFixed(2)}\n`
        );
        
        // Print results
        console.log("\nResults Comparison");
        console.log("=================");
        console.log(`Traditional game total cost: ${traditionalCost}`);
        console.log(`Standard blockchain-enabled game total cost: ${blockchainCost}`);
        console.log(`Optimized blockchain-enabled game total cost: ${optimizedBlockchainCost}`);
        console.log(`Cost reduction with standard blockchain: ${costReduction} (${costReductionPercent.toFixed(2)}%)`);
        console.log(`Cost reduction with optimized blockchain: ${optimizedCostReduction} (${optimizedCostReductionPercent.toFixed(2)}%)`);
        console.log(`Improvement from optimization: ${blockchainCost - optimizedBlockchainCost} (${((blockchainCost - optimizedBlockchainCost) * 100 / blockchainCost).toFixed(2)}% better than standard blockchain)`);
        
        console.log("\n\nSimulation Complete");
        console.log("====================================");
        console.log(`Summary saved to: ${summaryPath}`);
        
        // Print final comparative table
        console.log("\nResults Summary Table:");
        console.log("Method | Total Cost | vs Traditional | % Improvement");
        console.log("-------|------------|----------------|-------------");
        console.log(
            `Traditional      | ${traditionalCost.toString().padEnd(10)} | - | -`
        );
        console.log(
            `Standard Blockchain | ${blockchainCost.toString().padEnd(10)} | ${costReduction.toString().padEnd(14)} | ${costReductionPercent.toFixed(2)}%`
        );
        console.log(
            `Optimized Blockchain | ${optimizedBlockchainCost.toString().padEnd(10)} | ${optimizedCostReduction.toString().padEnd(14)} | ${optimizedCostReductionPercent.toFixed(2)}%`
        );
        
    } catch (error) {
        console.error("Error in main function:", error);
        process.exit(1);
    }
}

// Execute the simulations
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 