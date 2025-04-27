/**
 * Triple Hybrid Policy Script for Beer Distribution Game
 * 
 * This script runs the beer distribution game simulation using real-world order flow data
 * from the Std_Order_Quantities.csv file for:
 * - Customer demand
 * - Retailer orders
 * - Wholesaler orders
 * - Distributor orders
 * 
 * Only the Factory uses the algorithmic policy.
 * 
 * The simulation can be run with or without blockchain visibility for the algorithmic player.
 */

const { ethers } = require("hardhat");
const orderPolicy = require('./policies/orderPolicy');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Enum values for roles from BeerDistributionGame contract
const Role = {
    RETAILER: 0,
    WHOLESALER: 1,
    DISTRIBUTOR: 2,
    FACTORY: 3
};

/**
 * Convert a BigInt or ethers BigNumber to a regular number
 * @param {BigInt|BigNumber} value - The value to convert
 * @returns {number} - The value as a regular number
 */
function toNumber(value) {
    // Handle null/undefined
    if (value == null) return 0;
    
    // Check if it's a BigNumber from ethers
    if (value._isBigNumber) {
        return parseInt(value.toString());
    }
    
    // Check if it's a native BigInt
    if (typeof value === 'bigint') {
        return Number(value);
    }
    
    // If it's already a number, return it
    if (typeof value === 'number') {
        return value;
    }
    
    // Try to convert strings to numbers
    if (typeof value === 'string') {
        return Number(value);
    }
    
    // Default case - attempt to convert or return 0
    try {
        return Number(value);
    } catch (e) {
        console.error("Could not convert value to number:", value);
        return 0;
    }
}

/**
 * Calculate a moving average over the last n periods
 * @param {Array} data - Array of numeric data points
 * @param {number} windowSize - Size of the moving average window
 * @returns {number} - The moving average
 */
function calculateMovingAverage(data, windowSize = 3) {
    if (!data || !data.length) return 4; // Default value if no data
    
    // Use most recent values up to windowSize
    const recentData = data.slice(-windowSize);
    
    // Calculate the average
    const sum = recentData.reduce((acc, val) => acc + val, 0);
    return sum / recentData.length;
}

/**
 * Read triple hybrid order flow data from CSV file
 * @param {string} filePath - Path to CSV file
 * @returns {Promise<Array>} - Array of order data objects
 */
async function readOrderFlowData(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        
        // Create readable stream from CSV file
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                // Extract demand and order data from the row
                const customerDemand = parseFloat(data['Customer → FL Orders ($)']);
                const retailerOrder = parseFloat(data['FL → Crocs Orders ($)']);
                const wholesalerOrder = parseFloat(data['Crocs → YY Orders ($)']); 
                const distributorOrder = parseFloat(data['YY → SF Orders ($)']); // Fixed column name to match CSV
                
                // Only push valid numbers
                if (!isNaN(customerDemand) && !isNaN(retailerOrder) && 
                    !isNaN(wholesalerOrder) && !isNaN(distributorOrder)) {
                    // Scale down to appropriate range for simulation (optional - adjust if needed)
                    const scaledDemand = Math.round(customerDemand);
                    const scaledRetailerOrder = Math.round(retailerOrder);
                    const scaledWholesalerOrder = Math.round(wholesalerOrder);
                    const scaledDistributorOrder = Math.round(distributorOrder);
                    
                    results.push({
                        customerDemand: scaledDemand,
                        retailerOrder: scaledRetailerOrder,
                        wholesalerOrder: scaledWholesalerOrder,
                        distributorOrder: scaledDistributorOrder
                    });
                }
            })
            .on('end', () => {
                if (results.length === 0) {
                    reject(new Error('No valid order data found in CSV'));
                } else {
                    console.log(`Read ${results.length} periods of order data from CSV`);
                    console.log(`First 3 periods:`);
                    for (let i = 0; i < Math.min(3, results.length); i++) {
                        console.log(`  Period ${i+1}: Customer Demand = ${results[i].customerDemand}, Retailer Order = ${results[i].retailerOrder}, Wholesaler Order = ${results[i].wholesalerOrder}, Distributor Order = ${results[i].distributorOrder}`);
                    }
                    resolve(results);
                }
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

// Import the functions from runHybridRetailerPolicy.js
const baseScript = require('./runHybridRetailerPolicy');
const getOrderData = baseScript.getOrderData;
const placeAlgorithmicOrder = baseScript.placeAlgorithmicOrder;
const scheduleProduction = baseScript.scheduleProduction;

/**
 * Get state snapshot data
 * 
 * @param {Contract} gameContract - The game contract
 * @param {number} role - The role
 * @param {number} week - The week
 * @param {number} phase - The phase
 * @returns {object|null} - The state snapshot data or null if not available
 */
async function getStateSnapshotData(gameContract, role, week, phase) {
    try {
        // Check if snapshot exists first
        const exists = await gameContract.hasStateSnapshot(role, week, phase);
        if (!exists) {
            console.log(`No state snapshot available for role ${role}, week ${week}, phase ${phase}`);
            return null;
        }
        
        const snapshot = await gameContract.getStateSnapshot(role, week, phase);
        return {
            inventory: toNumber(snapshot[0]),
            backlog: toNumber(snapshot[1]),
            onOrder: toNumber(snapshot[2]),
            incomingOrder: toNumber(snapshot[3]),
            outgoingOrder: toNumber(snapshot[4]),
            incomingShipment: toNumber(snapshot[5]),
            outgoingShipment: toNumber(snapshot[6]),
            weeklyCost: toNumber(snapshot[7]),
            phase: toNumber(snapshot[8])
        };
    } catch (error) {
        console.error(`Error getting state snapshot for role ${role}, week ${week}, phase ${phase}:`, error);
        return null;
    }
}

/**
 * Collect weekly data for a role
 * 
 * @param {Contract} gameContract - The game contract
 * @param {number} week - The week
 * @param {string} roleName - The role name
 * @param {number} role - The role
 * @param {object} orderData - The order data
 * @param {number} prevTotalCost - The previous total cost
 * @returns {object} - The weekly data
 */
async function collectWeeklyData(gameContract, week, roleName, role, orderData, prevTotalCost) {
    // Get all snapshots for this week
    try {
        // Get the WEEK_START snapshot (before any processing)
        const weekStartSnapshot = await getStateSnapshotData(gameContract, role, week, 0); // Phase.WEEK_START
        
        // Get the AFTER_SHIPMENTS snapshot (after shipments arrived)
        const afterShipmentsSnapshot = await getStateSnapshotData(gameContract, role, week, 1); // Phase.AFTER_SHIPMENTS
        
        // Get the AFTER_ORDERS snapshot (after order decisions)
        const afterOrdersSnapshot = await getStateSnapshotData(gameContract, role, week, 2); // Phase.AFTER_ORDERS
        
        // Get the WEEK_END snapshot (final state at end of week)
        const weekEndSnapshot = await getStateSnapshotData(gameContract, role, week, 3); // Phase.WEEK_END
        
        // Calculate the total cost up to this week
        const totalCost = prevTotalCost + (weekEndSnapshot ? weekEndSnapshot.weeklyCost : 0);
        
        return {
            // Initial state (beginning of week)
            inventory: weekStartSnapshot ? weekStartSnapshot.inventory : 0,
            backlog: weekStartSnapshot ? weekStartSnapshot.backlog : 0,
            onOrder: weekStartSnapshot ? weekStartSnapshot.onOrder : 0,
            
            // After shipments arrived
            inventoryAfterShipments: afterShipmentsSnapshot ? afterShipmentsSnapshot.inventory : 0,
            backlogAfterShipments: afterShipmentsSnapshot ? afterShipmentsSnapshot.backlog : 0,
            incomingShipment: afterShipmentsSnapshot ? afterShipmentsSnapshot.incomingShipment : 0,
            
            // After orders processed
            inventoryAfterOrders: afterOrdersSnapshot ? afterOrdersSnapshot.inventory : 0,
            backlogAfterOrders: afterOrdersSnapshot ? afterOrdersSnapshot.backlog : 0,
            incomingOrder: afterOrdersSnapshot ? afterOrdersSnapshot.incomingOrder : 0,
            outgoingShipment: afterOrdersSnapshot ? afterOrdersSnapshot.outgoingShipment : 0,
            
            // End of week state
            inventoryEnd: weekEndSnapshot ? weekEndSnapshot.inventory : 0,
            backlogEnd: weekEndSnapshot ? weekEndSnapshot.backlog : 0,
            
            // Order and cost information
            order: orderData?.amount || 0,
            algorithmicOrder: orderData?.algorithmicAmount || 0, // Store what algorithmic policy would have ordered
            weeklyCost: weekEndSnapshot ? weekEndSnapshot.weeklyCost : 0,
            totalCost: totalCost
        };
    } catch (error) {
        console.error(`Error collecting weekly data for ${roleName} (role ${role}) in week ${week}:`, error);
        return {
            inventory: 0,
            backlog: 0,
            onOrder: 0,
            incomingShipment: 0,
            outgoingShipment: 0,
            inventoryEnd: 0,
            backlogEnd: 0,
            order: orderData?.amount || 0,
            algorithmicOrder: orderData?.algorithmicAmount || 0,
            weeklyCost: 0,
            totalCost: prevTotalCost
        };
    }
}

/**
 * Place a fixed order based on CSV data
 * 
 * @param {Contract} gameContract - The BeerDistributionGame contract
 * @param {object} signer - The signer for the role
 * @param {number} orderAmount - The fixed order amount from CSV
 * @param {number} role - The role placing the order
 * @returns {Promise<object>} - Order data including amount
 */
async function placeFixedOrder(gameContract, signer, orderAmount, role) {
    try {
        // Get order data just for logging (we won't use it to calculate the order)
        const orderData = await getOrderData(gameContract, role, false);
        
        // The order amount is pre-determined from CSV
        // Place the order
        const tx = await gameContract.connect(signer).placeOrder(orderAmount);
        await tx.wait();
        
        // Log for debugging
        let roleName = "Unknown";
        switch(role) {
            case Role.RETAILER: roleName = "Retailer"; break;
            case Role.WHOLESALER: roleName = "Wholesaler"; break;
            case Role.DISTRIBUTOR: roleName = "Distributor"; break;
            case Role.FACTORY: roleName = "Factory"; break;
        }
        
        console.log(`${roleName} placing FIXED order of ${orderAmount} units from CSV data`);
        
        // Calculate what the algorithmic amount would have been (for comparison)
        const algorithmicAmount = orderPolicy.calculateOrder(orderData);
        console.log(`For comparison: Algorithmic policy would have ordered ${algorithmicAmount} units`);
        
        return { amount: orderAmount, algorithmicAmount: algorithmicAmount };
    } catch (error) {
        console.error(`Error in placeFixedOrder for role ${role}:`, error);
        throw error;
    }
}

/**
 * Run the game simulation with triple hybrid policy:
 * - Fixed order data from CSV for customer demand, retailer orders, wholesaler orders, and distributor orders
 * - Algorithmic policy only for factory
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer[]} signers - Array of signers for each role
 * @param {Array} orderFlowData - Array of order data from CSV
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility for algorithmic players
 * @param {number} demandPattern - Demand pattern to override in contract (3 for CUSTOM)
 * @param {number} weeks - Number of weeks to run (limited by CSV data)
 * @returns {Object} Game results and data
 */
async function runGameWithTripleHybridPolicy(gameContract, signers, orderFlowData, hasBlockchainVisibility = false, demandPattern = 3, weeks = 20) {
    try {
        // Limit weeks to available data
        weeks = Math.min(weeks, orderFlowData.length);
        console.log(`Running simulation for ${weeks} weeks with ${hasBlockchainVisibility ? 'blockchain' : 'traditional'} visibility`);
        
        // Set custom demand pattern in contract using order flow data
        const customerDemandData = orderFlowData.map(entry => entry.customerDemand);
        console.log(`Setting custom customer demand pattern: ${customerDemandData.slice(0, 5).join(', ')}...`);
        
        // Initialize game with owner
        const owner = await ethers.provider.getSigner(0);
        
        // Set custom demand pattern
        await gameContract.connect(owner).setCustomDemandPattern(customerDemandData);
        
        // Initialize game with specified demand pattern
        await gameContract.connect(owner).initializeGame(demandPattern); // 3 = CUSTOM
        
        // Assign players to roles
        for (let i = 0; i < 4; i++) {
            await gameContract.connect(owner).assignPlayer(signers[i].address, i);
        }
        
        // Setup for data collection
        const weeklyData = {
            customer: [],
            retailer: [],
            wholesaler: [],
            distributor: [],
            factory: [],
            totalCost: []
        };
        
        let previousTotalCosts = {
            retailer: 0,
            wholesaler: 0,
            distributor: 0,
            factory: 0
        };
        
        // Run simulation for specified number of weeks
        for (let week = 0; week < weeks; week++) {
            console.log(`\n==== Processing Week ${week} ====`);
            
            // Get customer demand for this week from contract (should match our CSV data)
            let customerDemand;
            try {
                customerDemand = await gameContract.getCurrentCustomerDemand();
                customerDemand = toNumber(customerDemand);
                weeklyData.customer[week] = { demand: customerDemand };
                console.log(`Customer demand for week ${week}: ${customerDemand} units`);
            } catch (error) {
                console.log("Could not get customer demand for this week.");
                customerDemand = "Unknown";
            }
            
            // 1. Retailer places FIXED order from CSV data
            const retailerFixedOrder = orderFlowData[week].retailerOrder;
            console.log(`Using fixed retailer order from CSV: ${retailerFixedOrder} units`);
            const retailerOrder = await placeFixedOrder(gameContract, signers[0], retailerFixedOrder, Role.RETAILER);
            
            // 2. Wholesaler places FIXED order from CSV data
            const wholesalerFixedOrder = orderFlowData[week].wholesalerOrder;
            console.log(`Using fixed wholesaler order from CSV: ${wholesalerFixedOrder} units`);
            const wholesalerOrder = await placeFixedOrder(gameContract, signers[1], wholesalerFixedOrder, Role.WHOLESALER);
            
            // 3. Distributor places FIXED order from CSV data
            const distributorFixedOrder = orderFlowData[week].distributorOrder;
            console.log(`Using fixed distributor order from CSV: ${distributorFixedOrder} units`);
            const distributorOrder = await placeFixedOrder(gameContract, signers[2], distributorFixedOrder, Role.DISTRIBUTOR);
            
            // 4. Factory schedules production (algorithmic)
            const factoryOrder = await scheduleProduction(gameContract, signers[3], hasBlockchainVisibility);
            
            // Process the week
            await gameContract.connect(owner).processWeek();
            
            // Collect data for each role
            const roleOrders = [retailerOrder, wholesalerOrder, distributorOrder, factoryOrder];
            const roleNames = ["retailer", "wholesaler", "distributor", "factory"];
            
            for (let role = 0; role < 4; role++) {
                const roleName = roleNames[role];
                const prevTotalCost = previousTotalCosts[roleName];
                
                // Collect detailed state data for this role/week
                weeklyData[roleName][week] = await collectWeeklyData(
                    gameContract, 
                    week, 
                    roleName, 
                    role, 
                    roleOrders[role], 
                    prevTotalCost
                );
                
                // Update the previous total cost for next week
                previousTotalCosts[roleName] = weeklyData[roleName][week].totalCost;
            }
            
            // Calculate and store total supply chain cost for this week
            const totalCost = await gameContract.getTotalSupplyChainCost();
            weeklyData.totalCost[week] = toNumber(totalCost);
            console.log(`Total supply chain cost after week ${week}: ${toNumber(totalCost)}`);
        }
        
        // Calculate final cost
        const finalCost = await gameContract.getTotalSupplyChainCost();
        console.log(`\nFinal total supply chain cost: ${toNumber(finalCost)}`);
        
        return {
            weeklyData,
            finalCost
        };
    } catch (error) {
        console.error("Error in runGameWithTripleHybridPolicy:", error);
        throw error;
    }
}

/**
 * Save simulation data to a JSON file
 * 
 * @param {string} filePath - The file path
 * @param {object} data - The data to save
 */
function saveDataToJson(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Simulation data saved to ${filePath}`);
    } catch (error) {
        console.error(`Error saving data to ${filePath}:`, error);
    }
}

/**
 * Run a single simulation with specified parameters
 * 
 * @param {Array} orderFlowData - Array of order data from CSV
 * @param {number} periods - Number of periods to simulate
 * @param {boolean} useBlockchain - Whether to use blockchain visibility
 * @param {string} label - Label for the simulation (for file naming)
 */
async function runSimulation(orderFlowData, periods, useBlockchain, label) {
    console.log(`\n\nRunning ${useBlockchain ? 'blockchain-enabled' : 'traditional'} game for ${periods} periods...`);
    
    // Get signers for different roles
    const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
    
    // Deploy a fresh contract
    const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
    const game = await BeerDistributionGame.deploy();
    
    // Set initial inventory to 40 (increased from default for stability)
    await game.setInitialInventory(40);
    console.log(`Initial inventory set to 40 units for all supply chain members`);
    
    // Define DemandPattern enum values
    const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
    
    // Run simulation with triple hybrid policy
    const result = await runGameWithTripleHybridPolicy(
        game,
        [retailer, wholesaler, distributor, factory],
        orderFlowData,
        useBlockchain,
        DemandPattern.CUSTOM,
        periods
    );
    
    const totalCost = toNumber(result.finalCost);
    const weeklyData = result.weeklyData;
    
    // Save data to JSON
    const visibilityLabel = useBlockchain ? 'blockchain' : 'traditional';
    const dataPath = path.join(__dirname, `../visualization/data_${visibilityLabel}_triple_hybrid_${periods}_periods_full_${label}.json`);
    saveDataToJson(dataPath, weeklyData);
    
    return {
        totalCost,
        weeklyData
    };
}

/**
 * Main function to run simulations
 */
async function main() {
    try {
        console.log("Starting Triple Hybrid Policy Simulations");
        console.log("=================================================\n");
        
        // Get signers for reference
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        
        console.log("Using accounts:");
        console.log(`Owner: ${owner.address}`);
        console.log(`Retailer: ${retailer.address}`);
        console.log(`Wholesaler: ${wholesaler.address}`);
        console.log(`Distributor: ${distributor.address}`);
        console.log(`Factory: ${factory.address}\n`);
        
        // Read order flow data from CSV
        const csvFilePath = path.join(__dirname, '../Std_Order_Quantities.csv');
        let orderFlowData;
        
        try {
            orderFlowData = await readOrderFlowData(csvFilePath);
            console.log(`Successfully loaded order flow data from ${csvFilePath}`);
            console.log(`Total periods available: ${orderFlowData.length}`);
        } catch (error) {
            console.error("Error reading CSV file:", error);
            console.log("Cannot proceed without order flow data");
            process.exit(1);
        }
        
        // Create summary file
        const summaryPath = path.join(__dirname, '../visualization/triple_hybrid_simulation_summary.csv');
        fs.writeFileSync(summaryPath, 'Periods,TraditionalCost,BlockchainCost,CostReduction,CostReductionPercent\n');
        
        // Use the full number of periods available in the data (23 periods)
        const periods = orderFlowData.length;
        console.log(`\n\n==========================================`);
        console.log(`SIMULATION WITH ${periods} PERIODS (full available data)`);
        console.log(`==========================================`);
        
        // Run traditional simulation
        const traditionalResult = await runSimulation(
            orderFlowData, 
            periods, 
            false, // No blockchain visibility
            `traditional`
        );
        
        // Run blockchain simulation
        const blockchainResult = await runSimulation(
            orderFlowData, 
            periods, 
            true, // With blockchain visibility
            `blockchain`
        );
        
        // Calculate cost reduction
        const traditionalCost = traditionalResult.totalCost;
        const blockchainCost = blockchainResult.totalCost;
        const costReduction = traditionalCost - blockchainCost;
        const costReductionPercent = traditionalCost > 0 ? 
            (costReduction * 100) / traditionalCost : 0;
        
        // Store results
        const results = [{
            periods,
            traditionalCost,
            blockchainCost,
            costReduction,
            costReductionPercent
        }];
        
        // Append to summary CSV
        fs.appendFileSync(
            summaryPath, 
            `${periods},${traditionalCost},${blockchainCost},${costReduction},${costReductionPercent.toFixed(2)}\n`
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

// Export functions for use in other scripts
module.exports = {
    readOrderFlowData,
    placeFixedOrder,
    runGameWithTripleHybridPolicy,
    Role
}; 