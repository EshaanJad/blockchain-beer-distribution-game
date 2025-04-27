/**
 * Sterman Heuristic Simulation for Beer Distribution Game with Two Week Shipping Delay
 * 
 * This script runs the beer distribution game simulation using Sterman's
 * estimated decision heuristic as the baseline "human" behavior.
 * 
 * Parameters:
 * - Order Delay: 1 week (orders take 1 week to be received by the upstream supplier)
 * - Shipping Delay: 2 weeks (shipments take 2 weeks to arrive at the downstream partner)
 * 
 * It compares the performance of the Sterman heuristic with and without
 * blockchain visibility to demonstrate how better information could lead to
 * better performance, even if the underlying decision style remains similar.
 * 
 * Sterman's Heuristic Equation:
 * O_t = MAX[0, L_hat_t + alpha_S * (S' - S_t - beta * SL_t)]
 */

const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const stermanPolicy = require('./policies/stermanPolicy');
const csv = require('csv-parser');

// Track L_hat (demand forecast) for each player between weeks
const playerForecasts = {
    0: 4, // Retailer
    1: 4, // Wholesaler
    2: 4, // Distributor
    3: 4  // Factory
};

// Enum values for roles from BeerDistributionGame contract
const Role = {
    RETAILER: 0,
    WHOLESALER: 1,
    DISTRIBUTOR: 2,
    FACTORY: 3
};

// Array to store custom demand data from CSV
let customDemandData = [];

/**
 * Load custom demand data from CSV file
 * @param {string} filePath - Path to CSV file with demand data
 * @returns {Promise<Array>} - Array of demand values
 */
function loadCustomDemandData(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                // Extract customer demand from the "Customer → FL Orders ($)" column
                const customerDemand = parseInt(data['Customer → FL Orders ($)']) || 4;
                results.push(customerDemand);
            })
            .on('end', () => {
                console.log(`Loaded ${results.length} periods of custom demand data from ${filePath}`);
                resolve(results);
            })
            .on('error', (error) => {
                console.error('Error reading CSV file:', error);
                reject(error);
            });
    });
}

/**
 * Set custom demand data for the game contract
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Array} demandData - Array of demand values
 */
async function setCustomDemandData(gameContract, demandData) {
    console.log(`Setting custom demand data with ${demandData.length} periods`);
    try {
        const owner = await ethers.provider.getSigner(0);
        // Set custom demand data in contract
        await gameContract.connect(owner).setCustomDemandPattern(demandData);
        console.log("Custom demand data set successfully");
    } catch (error) {
        console.error("Error setting custom demand data:", error);
        throw error;
    }
}

/**
 * Calculate a moving average over the last n periods of data
 * @param {Array} data - Array of numeric values
 * @param {number} periods - Number of periods to average over
 * @returns {number} - The moving average value
 */
function calculateMovingAverage(data, periods) {
    if (!data || data.length === 0) return 4; // Default value if no data
    
    // Use the whole array if it's shorter than the requested periods
    const n = Math.min(periods, data.length);
    
    // Take the last n elements
    const relevantData = data.slice(-n);
    
    // Calculate the average
    const sum = relevantData.reduce((acc, val) => acc + val, 0);
    return sum / n;
}

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
 * Get necessary game data for the Sterman order calculation
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {number} role - The role (0-3) for which to calculate the order
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @returns {Object} - Data needed for order calculation
 */
async function getStermanOrderData(gameContract, role, hasBlockchainVisibility) {
    // Get member data from member information
    const memberData = await gameContract.getMemberData(role);
    const onHand = toNumber(memberData[0]);
    const backlog = toNumber(memberData[1]);
    
    // Get current week
    const currentWeek = toNumber(await gameContract.currentWeek());
    
    // Get shipment pipeline to calculate on-order inventory
    let onOrder = 0;
    try {
        const shipmentPipeline = await gameContract.getShipmentPipeline(role);
        onOrder = shipmentPipeline.reduce((sum, shipment) => sum + toNumber(shipment), 0);
        console.log(`Role ${role}: Calculated on-order from shipment pipeline: ${onOrder} units`);
    } catch (error) {
        console.error(`Error getting shipment pipeline for role ${role}:`, error);
        onOrder = 0;
    }
    
    // Get the last received order (for L_hat calculation)
    // For retailer, this is customer demand; for others, it's downstream player's order
    let lastReceivedOrder = 4; // default
    
    if (role === 0) { // Retailer
        try {
            // For retailer, use current customer demand
            const customerDemand = await gameContract.getCurrentCustomerDemand();
            lastReceivedOrder = toNumber(customerDemand);
        } catch (error) {
            console.error("Error getting customer demand:", error);
        }
    } else {
        // For other roles, get the order from the downstream player (role - 1)
        try {
            // If not week 0, get previous week's order
            if (currentWeek > 0) {
                const downstreamOrder = await gameContract.getMemberOrderForWeek(role - 1, currentWeek - 1);
                lastReceivedOrder = toNumber(downstreamOrder);
            }
        } catch (error) {
            console.error(`Error getting downstream order for role ${role}:`, error);
        }
    }
    
    console.log(`Role ${role}: Last received order = ${lastReceivedOrder}`);
    
    // Get stored forecast L_hat from previous week
    const previous_L_hat = playerForecasts[role];
    
    // For blockchain visibility, add end-customer demand information
    let smoothedEndCustomerDemand = undefined;
    if (hasBlockchainVisibility) {
        try {
            // Get all customer demand data available
            const allDemand = await gameContract.getCustomerDemand();
            
            // Convert to an array of numbers and slice to get history up to current week
            const customerDemandHistory = allDemand.map(d => toNumber(d)).slice(0, currentWeek + 1);
            
            if (customerDemandHistory.length > 0) {
                // Calculate smoothed end-customer demand using moving average
                smoothedEndCustomerDemand = calculateMovingAverage(customerDemandHistory, 3);
                console.log(`Calculated smoothed end-customer demand: ${smoothedEndCustomerDemand.toFixed(2)} (using last ${Math.min(3, customerDemandHistory.length)} weeks)`);
                
                if (customerDemandHistory.length > 1) {
                    // Also log some statistics about the demand
                    const avg = customerDemandHistory.reduce((sum, d) => sum + d, 0) / customerDemandHistory.length;
                    const sumSquaredDiff = customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0);
                    const demandStdDev = Math.sqrt(sumSquaredDiff / customerDemandHistory.length);
                    
                    console.log(`End-customer demand history: ${customerDemandHistory.slice(-3).join(', ')}`);
                    console.log(`End-customer demand std dev: ${demandStdDev.toFixed(2)}`);
                }
            }
        } catch (error) {
            console.error(`Error calculating smoothed end-customer demand:`, error);
            // If error occurs, use the current customer demand
            try {
                const currentCustomerDemand = await gameContract.getCurrentCustomerDemand();
                smoothedEndCustomerDemand = toNumber(currentCustomerDemand);
                console.log(`Using current customer demand as forecast: ${smoothedEndCustomerDemand}`);
            } catch (e) {
                console.error(`Error getting current customer demand:`, e);
            }
        }
    }
    
    // Package all data needed for Sterman's formula
    return {
        onHand,
        backlog,
        onOrder,
        lastReceivedOrder,
        previous_L_hat,
        role,
        hasBlockchainVisibility,
        smoothedEndCustomerDemand // Add the smoothed demand for blockchain visibility
    };
}

/**
 * Place an order using Sterman's heuristic
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - The signer (player) who will place the order
 * @param {number} role - The role (0-3) for which to place the order
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 */
async function placeStermanOrder(gameContract, signer, role, hasBlockchainVisibility) {
    console.log(`===== Placing Sterman order for ${roleToString(role)} =====`);
    
    // Get data needed for the order calculation
    const orderData = await getStermanOrderData(gameContract, role, hasBlockchainVisibility);
    
    // Calculate order using appropriate method based on visibility
    let result;
    if (hasBlockchainVisibility) {
        result = stermanPolicy.calculateStermanBlockchainOrder(orderData);
    } else {
        result = stermanPolicy.calculateStermanOrder(orderData);
    }
    
    // Extract order quantity and updated forecast
    const orderQuantity = result.order;
    const updated_L_hat = result.updated_L_hat;
    
    // Store updated forecast for next week
    playerForecasts[role] = updated_L_hat;
    
    // Place the order in the game contract
    const orderTx = await gameContract.connect(signer).placeOrder(orderQuantity);
    await orderTx.wait();
    
    console.log(`${roleToString(role)} placed order of ${orderQuantity} units`);
    console.log(`Updated forecast for next week: ${updated_L_hat.toFixed(2)}`);
    
    return orderQuantity;
}

/**
 * Schedule production using Sterman's heuristic (for Factory role)
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - The signer (factory) who will schedule production
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 */
async function scheduleStermanProduction(gameContract, signer, hasBlockchainVisibility) {
    console.log(`===== Scheduling Sterman production for Factory =====`);
    
    // Use the same logic as ordering for Factory (role 3)
    const orderData = await getStermanOrderData(gameContract, 3, hasBlockchainVisibility);
    
    // Calculate production quantity
    let result;
    if (hasBlockchainVisibility) {
        result = stermanPolicy.calculateStermanBlockchainOrder(orderData);
    } else {
        result = stermanPolicy.calculateStermanOrder(orderData);
    }
    
    // Extract production quantity and updated forecast
    const productionQuantity = result.order;
    const updated_L_hat = result.updated_L_hat;
    
    // Store updated forecast for next week
    playerForecasts[3] = updated_L_hat;
    
    // Schedule production
    const prodTx = await gameContract.connect(signer).scheduleProduction(productionQuantity);
    await prodTx.wait();
    
    console.log(`Factory scheduled production of ${productionQuantity} units`);
    console.log(`Updated forecast for next week: ${updated_L_hat.toFixed(2)}`);
    
    return productionQuantity;
}

// Helper function to convert role to string
function roleToString(role) {
    const roleNames = ["Retailer", "Wholesaler", "Distributor", "Factory"];
    return roleNames[role] || `Unknown Role (${role})`;
}

/**
 * Collect weekly data for a specific role
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {number} week - Current week
 * @param {string} roleName - Name of the role
 * @param {number} role - Role index
 * @param {number} orderData - Order placed this week
 * @param {number} prevTotalCost - Previous total cost
 * @returns {Object} - Weekly data for this role
 */
async function collectWeeklyData(gameContract, week, roleName, role, orderData, prevTotalCost) {
    // Get member data
    const memberData = await gameContract.getMemberData(role);
    const onHand = toNumber(memberData[0]);
    const backlog = toNumber(memberData[1]);
    
    // Get current order if available
    let currentOrder = orderData || 0;
    
    // Get current incoming if available
    let currentIncoming = 0;
    try {
        if (week > 0) {
            const incoming = await gameContract.getMemberIncomingForWeek(role, week - 1);
            currentIncoming = toNumber(incoming);
        }
    } catch (error) {
        console.error(`Error getting incoming for role ${role}, week ${week - 1}:`, error);
    }
    
    // Calculate weekly cost
    const weeklyCost = onHand * 0.5 + backlog * 1.0;
    const totalCost = prevTotalCost + weeklyCost;
    
    return {
        week,
        onHand,
        backlog,
        order: currentOrder,
        incoming: currentIncoming,
        weeklyCost,
        totalCost
    };
}

/**
 * Run the game with Sterman's heuristic policy
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Array} signers - Array of signers for each role
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @param {number} demandPattern - Demand pattern to use (0-3)
 * @param {number} weeks - Number of weeks to simulate
 * @returns {Object} - Final cost and weekly data
 */
async function runGameWithStermanPolicy(gameContract, signers, hasBlockchainVisibility, demandPattern = 0, weeks = 52) {
    console.log(`\n======= Starting Sterman ${hasBlockchainVisibility ? 'Blockchain-Enabled' : 'Traditional'} Simulation for ${weeks} weeks =======\n`);
    
    // Reset player forecasts
    for (let role = 0; role < 4; role++) {
        playerForecasts[role] = 4;
    }
    
    // Initialize game with owner
    const owner = await ethers.provider.getSigner(0);
    await gameContract.connect(owner).initializeGame(demandPattern);
    
    // Assign players to roles
    for (let i = 0; i < 4; i++) {
        await gameContract.connect(owner).assignPlayer(signers[i].address, i);
    }
    
    // Setup for data collection
    const weeklyData = [];
    
    let previousTotalCosts = {
        0: 0, // Retailer
        1: 0, // Wholesaler
        2: 0, // Distributor
        3: 0  // Factory
    };
    
    // Run simulation for specified number of weeks
    for (let week = 0; week < weeks; week++) {
        console.log(`\nProcessing Week ${week}`);
        
        // Get customer demand for this week (for logging)
        let customerDemand;
        try {
            customerDemand = await gameContract.getCurrentCustomerDemand();
            customerDemand = toNumber(customerDemand);
            console.log(`Customer demand for week ${week}: ${customerDemand}`);
        } catch (error) {
            console.log("Could not get customer demand for this week.");
            customerDemand = "Unknown";
        }
        
        // 1. Retailer places order to wholesaler
        const retailerOrder = await placeStermanOrder(gameContract, signers[0], Role.RETAILER, hasBlockchainVisibility);
        
        // 2. Wholesaler places order to distributor
        const wholesalerOrder = await placeStermanOrder(gameContract, signers[1], Role.WHOLESALER, hasBlockchainVisibility);
        
        // 3. Distributor places order to factory
        const distributorOrder = await placeStermanOrder(gameContract, signers[2], Role.DISTRIBUTOR, hasBlockchainVisibility);
        
        // 4. Factory schedules production
        const factoryOrder = await scheduleStermanProduction(gameContract, signers[3], hasBlockchainVisibility);
        
        // Process the week (this handles all the mechanics, deliveries, and phase transitions)
        await gameContract.connect(owner).processWeek();
        
        // Collect data for this week
        const currentWeekData = {
            week,
            inventory: [],
            backlog: [],
            orders: [],
            incoming: [],
            cost: [],
            cumulativeCost: []
        };
        
        // Orders for each role
        const roleOrders = [retailerOrder, wholesalerOrder, distributorOrder, factoryOrder];
        let weekTotalCost = 0;
        
        // Collect data for each role
        for (let role = 0; role < 4; role++) {
            // Get member data
            const memberData = await gameContract.getMemberData(role);
            const onHand = toNumber(memberData[0]);
            const backlog = toNumber(memberData[1]);
            
            // Calculate weekly cost
            const weeklyCost = onHand * 0.5 + backlog * 1.0;
            weekTotalCost += weeklyCost;
            
            // Get incoming orders/shipments if available
            let currentIncoming = 0;
            try {
                if (week > 0) {
                    const incoming = await gameContract.getMemberIncomingForWeek(role, week - 1);
                    currentIncoming = toNumber(incoming);
                }
            } catch (error) {
                // Ignore error for incoming
            }
            
            // Add data to the arrays
            currentWeekData.inventory.push(onHand);
            currentWeekData.backlog.push(backlog);
            currentWeekData.orders.push(roleOrders[role]);
            currentWeekData.incoming.push(currentIncoming);
            currentWeekData.cost.push(weeklyCost);
            
            // Update previous total cost for this role
            previousTotalCosts[role] += weeklyCost;
            currentWeekData.cumulativeCost.push(previousTotalCosts[role]);
        }
        
        // Add this week's data to the collection
        weeklyData.push(currentWeekData);
        
        console.log(`Week ${week} completed. Weekly total cost: ${weekTotalCost}`);
    }
    
    // Calculate final total cost (sum of all roles' total costs)
    const finalCost = Object.values(previousTotalCosts).reduce((sum, cost) => sum + cost, 0);
    console.log(`\n======= Simulation completed. Final cost: ${finalCost} =======\n`);
    
    return {
        finalCost,
        weeklyData
    };
}

/**
 * Run both simulations (with and without blockchain visibility) and save results
 */
async function main() {
    try {
        // Load custom demand data from CSV
        const csvPath = path.resolve(__dirname, '../Forecasted-Crox-Data.csv');
        customDemandData = await loadCustomDemandData(csvPath);
        
        // Number of periods to simulate (use length of demand data or default to 52)
        const periods = customDemandData.length > 0 ? customDemandData.length : 52;
        console.log(`Will simulate ${periods} periods using custom demand data`);
        
        // Get signers for different roles
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        const gamePlayers = [retailer, wholesaler, distributor, factory];
        
        // Define DemandPattern enum values
        const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
        
        // Create directories for results if they don't exist
        const vizDir = path.join(__dirname, '../visualization');
        if (!fs.existsSync(vizDir)) {
            fs.mkdirSync(vizDir, { recursive: true });
        }
        
        // Traditional simulation (without blockchain visibility)
        console.log("\n===== RUNNING TRADITIONAL SIMULATION (WITHOUT BLOCKCHAIN) =====\n");
        
        // Deploy a fresh contract for traditional simulation
        const BeerDistributionGameTraditional = await ethers.getContractFactory("BeerDistributionGame");
        const gameTraditional = await BeerDistributionGameTraditional.deploy();
        
        // Set initial inventory
        await gameTraditional.setInitialInventory(12);
        
        // Set delay periods - One week order delay, two weeks shipping delay
        await gameTraditional.setOrderDelayPeriod(1);
        console.log("Order delay set to 1 week");
        
        await gameTraditional.setShippingDelayPeriod(2);
        console.log("Shipping delay set to 2 weeks");
        
        // Set custom demand data
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameTraditional, customDemandData);
        }
        
        // Run traditional simulation
        const traditionalResult = await runGameWithStermanPolicy(
            gameTraditional,
            gamePlayers,
            false, // no blockchain visibility
            DemandPattern.CUSTOM, // Using custom demand pattern
            periods
        );
        const traditionalCost = traditionalResult.finalCost;
        const traditionalData = traditionalResult.weeklyData;
        
        // Save traditional data
        const traditionalPath = path.join(vizDir, 'data_traditional_sterman_two_shipping_delay.json');
        fs.writeFileSync(traditionalPath, JSON.stringify(traditionalData, null, 2));
        console.log(`Traditional simulation data saved to ${traditionalPath}`);
        
        // Blockchain-enabled simulation
        console.log("\n===== RUNNING BLOCKCHAIN-ENABLED SIMULATION =====\n");
        
        // Deploy a fresh contract for blockchain simulation
        const BeerDistributionGameBlockchain = await ethers.getContractFactory("BeerDistributionGame");
        const gameBlockchain = await BeerDistributionGameBlockchain.deploy();
        
        // Set initial inventory
        await gameBlockchain.setInitialInventory(12);
        
        // Set delay periods - One week order delay, two weeks shipping delay
        await gameBlockchain.setOrderDelayPeriod(1);
        console.log("Order delay set to 1 week");
        
        await gameBlockchain.setShippingDelayPeriod(2);
        console.log("Shipping delay set to 2 weeks");
        
        // Set custom demand data
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameBlockchain, customDemandData);
        }
        
        // Run blockchain simulation
        const blockchainResult = await runGameWithStermanPolicy(
            gameBlockchain,
            gamePlayers,
            true, // with blockchain visibility
            DemandPattern.CUSTOM, // Using custom demand pattern
            periods
        );
        const blockchainCost = blockchainResult.finalCost;
        const blockchainData = blockchainResult.weeklyData;
        
        // Save blockchain data
        const blockchainPath = path.join(vizDir, 'data_blockchain_sterman_two_shipping_delay.json');
        fs.writeFileSync(blockchainPath, JSON.stringify(blockchainData, null, 2));
        console.log(`Blockchain simulation data saved to ${blockchainPath}`);
        
        // Calculate cost reduction and save summary
        const costReduction = traditionalCost - blockchainCost;
        const costReductionPercent = (costReduction / traditionalCost) * 100;
        
        console.log("\n===== SIMULATION SUMMARY =====");
        console.log(`Traditional Cost: ${traditionalCost}`);
        console.log(`Blockchain Cost: ${blockchainCost}`);
        console.log(`Cost Reduction: ${costReduction} (${costReductionPercent.toFixed(2)}%)`);
        
        // Save summary to CSV
        const summaryPath = path.join(vizDir, 'sterman_two_shipping_delay_simulation_summary.csv');
        const summaryContent = `Periods,TraditionalCost,BlockchainCost,CostReduction,CostReductionPercent\n${periods},${traditionalCost},${blockchainCost},${costReduction},${costReductionPercent.toFixed(2)}`;
        fs.writeFileSync(summaryPath, summaryContent);
        console.log(`Summary saved to ${summaryPath}`);
        
    } catch (error) {
        console.error("Error running simulation:", error);
    }
}

// Execute the main function and handle errors
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 