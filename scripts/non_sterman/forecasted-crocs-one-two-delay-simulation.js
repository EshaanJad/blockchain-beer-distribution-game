/**
 * Forecasted Crocs Supply Chain Simulation Script with One Week Order Delay and Two Week Shipping Delay
 * 
 * This script runs the beer distribution game simulation using forecasted order flow data
 * from the Crocs supply chain, specifically using customer demand from "Customer → FL Orders ($)"
 * column in the Forecasted-Crox-Data.csv file.
 * 
 * It compares the performance of the same ordering policy with and without
 * blockchain visibility to demonstrate the value of full supply chain visibility.
 * 
 * Parameters:
 * - Order Delay: 1 week (orders take 1 week to be received by the upstream supplier)
 * - Shipping Delay: 2 weeks (shipments take 2 weeks to arrive at the downstream partner)
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

// Diagnostic function to check the demand pattern
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
                // Parse to number - no scaling needed since data is already in appropriate range
                const customerDemand = parseFloat(data['Customer → FL Orders ($)']);
                
                // Only push valid numbers
                if (!isNaN(customerDemand)) {
                    // Use value directly as it's already in the appropriate range (no scaling needed)
                    results.push(customerDemand);
                }
            })
            .on('end', () => {
                if (results.length === 0) {
                    reject(new Error('No valid demand data found in CSV'));
                } else {
                    console.log(`Read ${results.length} demand data points from CSV`);
                    console.log(`Demand values (first 10): ${results.slice(0, 10).join(', ')}...`);
                    resolve(results);
                }
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
 */
async function runSimulation(customerDemandData, periods, useBlockchain, label) {
    console.log(`\n\nRunning ${useBlockchain ? 'blockchain-enabled' : 'traditional'} game for ${periods} periods...`);
    
    // Get signers for different roles
    const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
    
    // Deploy a fresh contract
    const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
    const game = await BeerDistributionGame.deploy();
    
    // Set initial inventory to 40 (increased from default 8)
    await game.setInitialInventory(40);
    console.log(`Initial inventory set to 40 units for all supply chain members`);
    
    // Set 1 week order delay
    await game.setOrderDelayPeriod(1);
    console.log("Order delay set to 1 week");
    
    // Set two week shipping delay
    await game.setShippingDelayPeriod(2);
    console.log("Shipping delay set to 2 weeks");
    
    // Define DemandPattern enum values
    const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
    
    // Use only the needed periods from the demand data
    const limitedDemandData = customerDemandData.slice(0, periods);
    
    // Set custom demand data in the contract
    const tx = await game.setCustomDemandPattern(limitedDemandData);
    await tx.wait();
    console.log(`Custom demand pattern set for ${periods} periods`);
    
    // Run simulation
    const result = await runPolicy.runGameWithPolicy(
        game,
        [retailer, wholesaler, distributor, factory],
        useBlockchain,
        DemandPattern.CUSTOM,
        periods
    );
    const totalCost = result.finalCost;
    const weeklyData = result.weeklyData;
    
    // Save data to JSON - ensure we create the directory structure if needed
    const visibilityLabel = useBlockchain ? 'blockchain' : 'traditional';
    
    // Save to both locations for compatibility
    // 1. Original location (delay_variants directory)
    const delayDir = path.join(__dirname, '../visualization/data/simulations/delay_variants');
    const delayPath = path.join(delayDir, `data_${visibilityLabel}_forecasted_crocs_one_two_delay_${periods}_periods.json`);
    
    // 2. New location (forecasted directory)
    const forecastedDir = path.join(__dirname, '../visualization/data/simulations/forecasted');
    const forecastedPath = path.join(forecastedDir, `data_${visibilityLabel}_forecasted_crocs_one_two_delay_${periods}_periods.json`);
    
    // Create the directories if they don't exist
    if (!fs.existsSync(delayDir)) {
        fs.mkdirSync(delayDir, { recursive: true });
    }
    
    if (!fs.existsSync(forecastedDir)) {
        fs.mkdirSync(forecastedDir, { recursive: true });
    }
    
    try {
        // Save to delay variants directory
        fs.writeFileSync(delayPath, JSON.stringify(weeklyData, null, 2));
        console.log(`Simulation data saved to ${delayPath}`);
        
        // Save to forecasted directory 
        fs.writeFileSync(forecastedPath, JSON.stringify(weeklyData, null, 2));
        console.log(`Simulation data also saved to ${forecastedPath}`);
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
        console.log("Starting Forecasted Crocs Supply Chain Simulations with One Week Order Delay and Two Week Shipping Delay");
        console.log("================================================================================================\n");
        
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
        const summaryPath = path.join(__dirname, '../visualization/forecasted_one_two_delay_simulation_summary.csv');
        fs.writeFileSync(summaryPath, 'Periods,TraditionalCost,BlockchainCost,CostReduction,CostReductionPercent\n');
        
        console.log(`\n\n==========================================`);
        console.log(`SIMULATION WITH ${maxPeriods} PERIODS (full forecasted data)`);
        console.log(`==========================================`);
        
        // Run traditional simulation
        const traditionalResult = await runSimulation(
            customerDemandData, 
            maxPeriods, 
            false, // No blockchain visibility
            `traditional_forecasted_one_two_delay_${maxPeriods}`
        );
        
        // Run blockchain simulation
        const blockchainResult = await runSimulation(
            customerDemandData, 
            maxPeriods, 
            true, // With blockchain visibility
            `blockchain_forecasted_one_two_delay_${maxPeriods}`
        );
        
        // Calculate cost reduction
        const traditionalCost = traditionalResult.totalCost;
        const blockchainCost = blockchainResult.totalCost;
        const costReduction = traditionalCost - blockchainCost;
        const costReductionPercent = traditionalCost > 0 ? 
            (costReduction * 100) / traditionalCost : 0;
        
        // Store results
        const results = [{
            periods: maxPeriods,
            traditionalCost,
            blockchainCost,
            costReduction,
            costReductionPercent
        }];
        
        // Append to summary CSV
        fs.appendFileSync(
            summaryPath, 
            `${maxPeriods},${traditionalCost},${blockchainCost},${costReduction},${costReductionPercent.toFixed(2)}\n`
        );
        
        // Print results
        console.log("\nResults Comparison");
        console.log("=================");
        console.log(`Traditional game total cost: ${traditionalCost}`);
        console.log(`Blockchain-enabled game total cost: ${blockchainCost}`);
        console.log(`Cost reduction with blockchain: ${costReduction} (${costReductionPercent.toFixed(2)}%)`);
        
        console.log("\n\nSimulation Complete");
        console.log("====================================");
        console.log(`Summary saved to: ${summaryPath}`);
        
        // Print final comparative table
        console.log("\nResults Summary Table:");
        console.log("Periods | Traditional Cost | Blockchain Cost | Cost Reduction | % Reduction");
        console.log("--------|------------------|----------------|---------------|------------");
        results.forEach(r => {
            console.log(
                `${r.periods.toString().padEnd(8)} | ` +
                `${r.traditionalCost.toString().padEnd(18)} | ` +
                `${r.blockchainCost.toString().padEnd(16)} | ` +
                `${r.costReduction.toString().padEnd(15)} | ` +
                `${r.costReductionPercent.toFixed(2)}%`
            );
        });
        
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