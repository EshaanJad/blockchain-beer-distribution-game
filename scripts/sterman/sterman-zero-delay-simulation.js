/**
 * Sterman Heuristic Simulation for Beer Distribution Game
 * 
 * This script runs the beer distribution game simulation using Sterman's
 * estimated decision heuristic as the baseline "human" behavior.
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
const stermanPolicy = require('../policies/stermanPolicy');
const csv = require('csv-parser');

// USD price per ETH for on-chain gas calculations
const ETH_USD_PRICE = 2500;
// Intended gas price for all simulation transactions (20 Gwei)
const INTENDED_GAS_PRICE_GWEI = "20";
const INTENDED_GAS_PRICE_WEI = ethers.parseUnits(INTENDED_GAS_PRICE_GWEI, "gwei");

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
 * Load custom demand data from Sterman scaled Footlocker to Crocs data CSV file
 * @param {string} filePath - Path to CSV file with scaled demand data
 * @returns {Promise<Array>} - Array of demand values
 */
function loadCustomDemandData(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                // Extract customer demand from the "Rounded_Scaled_Units_at_49" column
                const customerDemand = parseInt(data['Rounded_Scaled_Units_at_50']) || 4;
                results.push(customerDemand);
            })
            .on('end', () => {
                console.log(`Loaded ${results.length} periods of demand data from ${filePath}`);
                console.log(`Sample demand values: ${results.slice(0, 5).join(', ')}...`);
                
                // Ensure we have at least a few weeks of data
                if (results.length < 5) {
                    console.warn("WARNING: Very little demand data available. Adding default values to ensure simulation can run.");
                    // Pad with default values if needed
                    while (results.length < 5) {
                        results.push(6); // Use 6 as default (matches our TARGET_MEAN_BDG)
                    }
                }
                
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
    
    // Get order and shipping delay periods
    const orderDelay = toNumber(await gameContract.orderDelayPeriod());
    const shippingDelay = toNumber(await gameContract.shippingDelayPeriod());

    let onOrder = 0;

    // 1. Orders placed by this 'role' still in the supplier's order processing pipeline
    if (role !== Role.FACTORY) { // Factory schedules production, doesn't place orders on another supplier
        for (let i = 1; i <= orderDelay; i++) {
            if (currentWeek >= i) {
                try {
                    // Get the order this 'role' placed 'i' weeks ago
                    const pastOrder = await gameContract.getMemberOrderForWeek(role, currentWeek - i);
                    onOrder += toNumber(pastOrder);
                } catch (e) {
                    // console.warn(`Could not get order for role ${roleToString(role)} for week ${currentWeek - i}: ${e.message}`);
                }
            }
        }
    } else { // For Factory, its "supply line" is its production pipeline (WIP)
        try {
            const productionPipeline = await gameContract.getProductionPipeline();
            // console.log(`Role Factory (Week ${currentWeek}): Raw productionPipeline received = [${productionPipeline.map(p => p.toString()).join(', ')}]`);
            // productionPipeline[0] is completed goods this week (from LAST turn's scheduling).
            // productionPipeline[1] is work in progress, scheduled last turn, available next week. This is the "on order" for the factory.
                        // productionPipeline[0] is completed goods this week (from LAST turn's scheduling) and represents WIP becoming available.
            if (productionPipeline && productionPipeline.length > 0) { 
                 onOrder += toNumber(productionPipeline[0]); // Use [0] for WIP becoming available
            }
        } catch(e) {
            // console.warn(`Could not get production pipeline for Factory: ${e.message}`);
        }
    }

    // 2. Items in this 'role's' own shipmentPipeline (goods shipped by supplier, en route)
    if (shippingDelay > 0) { // This check is important; if shippingDelay is 0, no shipment pipeline.
        try {
            const shipmentPipelineDetails = await gameContract.getShipmentPipeline(role);
            const shippedItems = shipmentPipelineDetails.reduce((sum, shipment) => sum + toNumber(shipment), 0);
            onOrder += shippedItems;
            // console.log(`Role ${roleToString(role)} (Week ${currentWeek}): Added ${shippedItems} from own shipment pipeline to onOrder.`);
        } catch (error) {
            // console.error(`Error getting shipment pipeline for role ${roleToString(role)}: ${error.message}`);
        }
    }
    
    console.log(`Role ${roleToString(role)} (Week ${currentWeek}): OnHand=${onHand}, Backlog=${backlog}, Corrected OnOrder (SL_t)=${onOrder}`);
    
    // Get the last received order (for L_hat calculation in traditional mode or as base for others)
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
    
    console.log(`Role ${role}: Last received order (for traditional L_hat) = ${lastReceivedOrder}`);
    
    // Get stored forecast L_hat from previous week
    const previous_L_hat = playerForecasts[role]; // Assuming playerForecasts is globally available and updated
    
    // For blockchain visibility, prepare necessary demand information
    let smoothedEndCustomerDemand = undefined; // Still calculate for potential logging/comparison
    let currentEndCustomerDemandForLhat = 4;   // For the new L_hat calculation in blockchain mode

    if (hasBlockchainVisibility) {
        try {
            // Fetch current (unsmoothed) end-customer demand for the adaptive L_hat calculation
            const rawCurrentDemand = await gameContract.getCurrentCustomerDemand();
            currentEndCustomerDemandForLhat = toNumber(rawCurrentDemand);
            console.log(`Role ${role}: Fetched raw end-customer demand for L_hat_t (blockchain): ${currentEndCustomerDemandForLhat}`);

            // Fetch all customer demand data available for smoothed calculation (for logging or other potential uses)
            const allDemand = await gameContract.getCustomerDemand();
            // Convert to an array of numbers and slice to get history up to current week (inclusive of current week if week is 0-indexed)
            const customerDemandHistory = allDemand.map(d => toNumber(d)).slice(0, currentWeek + 1); 
            
            if (customerDemandHistory.length > 0) {
                // Calculate smoothed end-customer demand using moving average (ensure calculateMovingAverage is defined in the script)
                smoothedEndCustomerDemand = calculateMovingAverage(customerDemandHistory, 3); // Make sure calculateMovingAverage is defined
                console.log(`Role ${role}: Calculated smoothed end-customer demand (for logging/comparison): ${smoothedEndCustomerDemand.toFixed(2)}`);
                
                if (customerDemandHistory.length > 1) {
                    // Also log some statistics about the demand
                    const avg = customerDemandHistory.reduce((sum, d) => sum + d, 0) / customerDemandHistory.length;
                    const sumSquaredDiff = customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0);
                    const demandStdDev = Math.sqrt(sumSquaredDiff / customerDemandHistory.length);
                    
                    console.log(`Role ${role}: End-customer demand history (smoothing): ${customerDemandHistory.slice(-3).join(', ')}, StdDev: ${demandStdDev.toFixed(2)}`);
                }
            }
        } catch (error) {
            console.error(`Role ${role}: Error processing end-customer demand data for blockchain mode:`, error);
            // Fallback for smoothedEndCustomerDemand if primary fetch failed but raw fetch might have succeeded
            if (smoothedEndCustomerDemand === undefined && currentEndCustomerDemandForLhat !== undefined) { 
                 smoothedEndCustomerDemand = currentEndCustomerDemandForLhat; 
                 console.log(`Role ${role}: Using raw customer demand as fallback for smoothed: ${smoothedEndCustomerDemand}`);
            } else if (smoothedEndCustomerDemand === undefined) { 
                smoothedEndCustomerDemand = 4; // Default fallback
                 console.log(`Role ${role}: Using default (4) as fallback for smoothed demand due to errors.`);
            }
        }
    }
    
    // Package all data needed for Sterman's formula
    return {
        onHand,
        backlog,
        onOrder,
        lastReceivedOrder,          // Used by traditional policy for its L_hat
        previous_L_hat,             // Player's L_hat from previous week (used by both policies)
        role,
        hasBlockchainVisibility,
        smoothedEndCustomerDemand,  // Kept for logging or alternative blockchain policies
        currentEndCustomerDemandForLhat // NEW: Used by the revised blockchain policy for its L_hat
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
    
    // Place the order in the game contract and capture gas
    const orderTx = await gameContract.connect(signer).placeOrder(orderQuantity, {
        gasPrice: INTENDED_GAS_PRICE_WEI
    });
    let orderGasUsd = 0;
    if (hasBlockchainVisibility) {
        try {
            // Wait for transaction receipt and log raw values for debugging
            const orderReceipt = await orderTx.wait();
            console.log(`Debug Receipt for ${roleToString(role)}: gasUsed=${orderReceipt.gasUsed}, intendedGasPrice=${INTENDED_GAS_PRICE_WEI}`);

            if (orderReceipt && orderReceipt.gasUsed != null) {
                // Calculate cost using the INTENDED gas price for consistency
                const gasUsedBigInt = BigInt(orderReceipt.gasUsed.toString());
                const gasPriceBigInt = BigInt(INTENDED_GAS_PRICE_WEI.toString()); // Use the defined constant
                const gasCostWei = gasUsedBigInt * gasPriceBigInt;
                
                // Use string operations for extremely large numbers to avoid precision issues
                const gasCostWeiStr = gasCostWei.toString();
                let gasCostEth;
                if (gasCostWeiStr.length <= 18) {
                    const ethDecimal = "0." + "0".repeat(18 - gasCostWeiStr.length) + gasCostWeiStr;
                    gasCostEth = parseFloat(ethDecimal);
                } else {
                    const integerPart = gasCostWeiStr.slice(0, gasCostWeiStr.length - 18);
                    const decimalPart = gasCostWeiStr.slice(gasCostWeiStr.length - 18);
                    gasCostEth = parseFloat(integerPart + "." + decimalPart);
                }
                orderGasUsd = gasCostEth * ETH_USD_PRICE;
                console.log(`${roleToString(role)} placed order of ${orderQuantity} units (Gas cost: $${orderGasUsd.toFixed(2)})`);
            } else {
                console.log(`${roleToString(role)} placed order of ${orderQuantity} units (Receipt Gas Used info unavailable)`);
            }
        } catch (error) {
            console.error(`Error calculating gas for ${roleToString(role)}: ${error.message}`);
            await orderTx.wait(); // Still need to wait for the transaction
            console.log(`${roleToString(role)} placed order of ${orderQuantity} units (Gas calculation failed)`);
        }
    } else {
        await orderTx.wait(); // Still need to wait for the transaction
        console.log(`${roleToString(role)} placed order of ${orderQuantity} units`);
    }
    console.log(`Updated forecast for next week: ${updated_L_hat.toFixed(2)}`);

    return { orderQuantity, gasUsd: orderGasUsd };
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
    
    // Schedule production and capture gas
    const prodTx = await gameContract.connect(signer).scheduleProduction(productionQuantity, {
        gasPrice: INTENDED_GAS_PRICE_WEI
    });
    let prodGasUsd = 0;
    if (hasBlockchainVisibility) {
        try {
            // Wait for transaction receipt and log raw values for debugging
            const prodReceipt = await prodTx.wait();
            console.log(`Debug Receipt for Factory: gasUsed=${prodReceipt.gasUsed}, intendedGasPrice=${INTENDED_GAS_PRICE_WEI}`);

            if (prodReceipt && prodReceipt.gasUsed != null) {
                // Calculate cost using the INTENDED gas price for consistency
                const gasUsedBigInt = BigInt(prodReceipt.gasUsed.toString());
                const gasPriceBigInt = BigInt(INTENDED_GAS_PRICE_WEI.toString()); // Use the defined constant
                const gasCostWei = gasUsedBigInt * gasPriceBigInt;
                
                // Use string operations for extremely large numbers to avoid precision issues
                const gasCostWeiStr = gasCostWei.toString();
                let gasCostEth;
                if (gasCostWeiStr.length <= 18) {
                    const ethDecimal = "0." + "0".repeat(18 - gasCostWeiStr.length) + gasCostWeiStr;
                    gasCostEth = parseFloat(ethDecimal);
                } else {
                    const integerPart = gasCostWeiStr.slice(0, gasCostWeiStr.length - 18);
                    const decimalPart = gasCostWeiStr.slice(gasCostWeiStr.length - 18);
                    gasCostEth = parseFloat(integerPart + "." + decimalPart);
                }
                prodGasUsd = gasCostEth * ETH_USD_PRICE;
                console.log(`Factory scheduled production of ${productionQuantity} units (Gas cost: $${prodGasUsd.toFixed(2)})`);
            } else {
                console.log(`Factory scheduled production of ${productionQuantity} units (Receipt Gas Used info unavailable)`);
            }
        } catch (error) {
            console.error(`Error calculating gas for Factory: ${error.message}`);
            await prodTx.wait(); // Still need to wait for the transaction
            console.log(`Factory scheduled production of ${productionQuantity} units (Gas calculation failed)`);
        }
    } else {
        await prodTx.wait(); // Still need to wait for the transaction
        console.log(`Factory scheduled production of ${productionQuantity} units`);
    }
    console.log(`Updated forecast for next week: ${updated_L_hat.toFixed(2)}`);

    return { orderQuantity: productionQuantity, gasUsd: prodGasUsd };
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
    
    // Calculate weekly cost using original cost parameters
    const holdingCost = 0.5; // Original holding cost
    const backlogCost = 1.0; // Original backlog cost
    const weeklyCost = onHand * holdingCost + backlog * backlogCost;
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
async function runGameWithStermanPolicy(gameContract, signers, hasBlockchainVisibility, demandPattern = 0, weeks = 69) {
    console.log(`\n======= Starting Sterman ${hasBlockchainVisibility ? 'Blockchain-Enabled' : 'Traditional'} Simulation for ${weeks} weeks =======\n`);
    
    // In traditional mode, don't track any gas costs
    console.log(`Gas tracking: ${hasBlockchainVisibility ? 'Enabled (only for blockchain roles)' : 'Disabled (no gas costs in traditional mode)'}`);
    if (!hasBlockchainVisibility) {
        console.log('No transaction costs will be added to player costs in traditional mode');
    }
    
    // Reset player forecasts
    for (let role = 0; role < 4; role++) {
        playerForecasts[role] = 4;
    }
    
    // Get owner for operations
    const owner = await ethers.provider.getSigner(0);
    
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
        
        // Check if the game is still active (relevant for week 52)
        try {
            const isActive = await gameContract.gameActive();
            if (!isActive) {
                console.log(`Game has ended after week ${week}. Exiting simulation loop.`);
                break;
            }
        } catch (error) {
            console.warn("Could not check if game is active, continuing anyway:", error.message);
        }
        
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
        let retailerOrder = 0;
        let retailerGasUsd = 0;
        try {
            const res = await placeStermanOrder(gameContract, signers[0], Role.RETAILER, hasBlockchainVisibility);
            retailerOrder = res.orderQuantity;
            retailerGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error placing retailer order: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // 2. Wholesaler places order to distributor
        let wholesalerOrder = 0;
        let wholesalerGasUsd = 0;
        try {
            const res = await placeStermanOrder(gameContract, signers[1], Role.WHOLESALER, hasBlockchainVisibility);
            wholesalerOrder = res.orderQuantity;
            wholesalerGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error placing wholesaler order: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // 3. Distributor places order to factory
        let distributorOrder = 0;
        let distributorGasUsd = 0;
        try {
            const res = await placeStermanOrder(gameContract, signers[2], Role.DISTRIBUTOR, hasBlockchainVisibility);
            distributorOrder = res.orderQuantity;
            distributorGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error placing distributor order: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // 4. Factory schedules production
        let factoryOrder = 0;
        let factoryGasUsd = 0;
        try {
            const res = await scheduleStermanProduction(gameContract, signers[3], hasBlockchainVisibility);
            factoryOrder = res.orderQuantity;
            factoryGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error scheduling factory production: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // Process the week (this handles all the mechanics, deliveries, and phase transitions)
        let processWeekGasUsd = 0;
        try {
            const processTx = await gameContract.connect(owner).processWeek({
                gasPrice: INTENDED_GAS_PRICE_WEI
            });
            // Only calculate gas if we're in blockchain mode, but don't distribute to players
            if (hasBlockchainVisibility) {
                try {
                    // Wait for transaction receipt and log raw values for debugging
                    const processReceipt = await processTx.wait();
                    console.log(`Debug Receipt for Owner processWeek: gasUsed=${processReceipt.gasUsed}, intendedGasPrice=${INTENDED_GAS_PRICE_WEI}`);

                    if (processReceipt && processReceipt.gasUsed != null) {
                        // Calculate cost using the INTENDED gas price for consistency
                        const gasUsedBigInt = BigInt(processReceipt.gasUsed.toString());
                        const gasPriceBigInt = BigInt(INTENDED_GAS_PRICE_WEI.toString()); // Use the defined constant
                        const gasCostWei = gasUsedBigInt * gasPriceBigInt;
                        
                        // Convert wei to ETH (1 ETH = 10^18 wei)
                        const gasCostWeiStr = gasCostWei.toString();
                        let gasCostEth;
                        if (gasCostWeiStr.length <= 18) {
                            const ethDecimal = "0." + "0".repeat(18 - gasCostWeiStr.length) + gasCostWeiStr;
                            gasCostEth = parseFloat(ethDecimal);
                        } else {
                            const integerPart = gasCostWeiStr.slice(0, gasCostWeiStr.length - 18);
                            const decimalPart = gasCostWeiStr.slice(gasCostWeiStr.length - 18);
                            gasCostEth = parseFloat(integerPart + "." + decimalPart);
                        }
                        processWeekGasUsd = gasCostEth * ETH_USD_PRICE;
                        console.log(`Owner processed week (Gas cost: $${processWeekGasUsd.toFixed(2)} - not charged to players)`);
                    } else {
                        console.log(`Owner processed week (Receipt Gas Used info unavailable)`);
                    }
                } catch (error) {
                    console.error(`Error calculating gas for owner's processWeek: ${error.message}`);
                    console.log(`Owner processed week (Gas calculation failed)`);
                }
            } else {
                await processTx.wait();
                console.log(`Owner processed week`);
            }
        } catch (error) {
            console.error(`Error processing week: ${error.message}`);
            if (error.message.includes("Game has ended")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // Collect data for this week
        const currentWeekData = {
            week,
            inventory: [],
            backlog: [],
            orders: [],
            incoming: [],
            operationalCost: [], // Renamed from cost to clarify it's operational only
            gas: [],
            systemGas: processWeekGasUsd, // Track system gas separately
            cumulativeCost: [],
            // New fields to track separate cost components
            totalGasCost: [], // Total gas cost per role (will not be included in cumulativeCost)
            totalCostWithGas: [] // Total cost including gas (for reference only)
        };
        
        // Orders for each role and their gas costs
        const roleOrders = [retailerOrder, wholesalerOrder, distributorOrder, factoryOrder];
        const roleGas = [retailerGasUsd, wholesalerGasUsd, distributorGasUsd, factoryGasUsd];
        let weekTotalCost = 0;
        let weekTotalGasCost = 0;
        
        // Collect data for each role (including gas costs)
        for (let role = 0; role < 4; role++) {
            // Get member data
            const memberData = await gameContract.getMemberData(role);
            const onHand = toNumber(memberData[0]);
            const backlog = toNumber(memberData[1]);
            
            // Calculate operational cost (holding + backlog only)
            const holdBackCost = onHand * 0.5 + backlog * 1.0;
            const gasForRole = roleGas[role] || 0;
            weekTotalCost += holdBackCost; // Only operational costs included in weekTotalCost
            weekTotalGasCost += gasForRole; // Track gas costs separately
            
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
            currentWeekData.operationalCost.push(holdBackCost); // Only store operational cost
            currentWeekData.gas.push(gasForRole);
            currentWeekData.totalGasCost.push(gasForRole); // Same as gas for now, but could include other components
            currentWeekData.totalCostWithGas.push(holdBackCost + gasForRole); // Total cost including gas (for reference)
            
            // Update previous total cost for this role
            previousTotalCosts[role] += holdBackCost; // Only operational costs included in cumulative total
            currentWeekData.cumulativeCost.push(previousTotalCosts[role]);
        }
        
        // Add this week's data to the collection
        weeklyData.push(currentWeekData);
        
        console.log(`Week ${week} completed. Weekly operational cost: ${weekTotalCost}${hasBlockchainVisibility ? `, Gas cost: ${weekTotalGasCost}` : ''}`);
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
        // Load custom demand data from footlocker_to_crocs_order_value_transformed_v3.csv
        const csvPath = path.resolve(__dirname, '../../footlocker_to_crocs_order_value_transformed_v3.csv');
        customDemandData = await loadCustomDemandData(csvPath);
        
        // Number of periods to simulate (use all available data up to 69 weeks maximum)
        // Contract has been modified to support up to 70 weeks (0-69)
        const MAX_SIMULATION_WEEKS = 69;
        const periods = customDemandData.length > 0 ? Math.min(customDemandData.length, MAX_SIMULATION_WEEKS) : 25;
        console.log(`Will simulate ${periods} periods using Sterman scaled Footlocker-Crocs data (maximum allowed: ${MAX_SIMULATION_WEEKS})`);
        
        // Get signers for different roles
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        const gamePlayers = [retailer, wholesaler, distributor, factory];
        
        // Define DemandPattern enum values
        const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
        
        // Create directories for results if they don't exist
        const vizDir = path.join(__dirname, '../../visualization');
        if (!fs.existsSync(vizDir)) {
            fs.mkdirSync(vizDir, { recursive: true });
        }
        
        // Create a simulation-specific directory for this run
        const simDir = path.join(vizDir, 'data/simulations/sterman/zero-delay');
        if (!fs.existsSync(simDir)) {
            fs.mkdirSync(simDir, { recursive: true });
        }
        
        // Traditional simulation (without blockchain visibility)
        console.log("\n===== RUNNING TRADITIONAL SIMULATION (WITHOUT BLOCKCHAIN) =====\n");
        
        // Deploy a fresh contract for traditional simulation
        const BeerDistributionGameTraditional = await ethers.getContractFactory("BeerDistributionGame");
        const gameTraditional = await BeerDistributionGameTraditional.deploy();
        
        // Set initial inventory
        await gameTraditional.setInitialInventory(12);
        await gameTraditional.setShippingDelayPeriod(1);
        await gameTraditional.setOrderDelayPeriod(0);
        
        // Set custom demand data BEFORE initializing game
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameTraditional, customDemandData);
        }
        
        // Initialize game with owner
        await gameTraditional.connect(owner).initializeGame(DemandPattern.CUSTOM);
        
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
        const traditionalPath = path.join(simDir, 'traditional.json');
        fs.writeFileSync(traditionalPath, JSON.stringify(traditionalData, null, 2));
        console.log(`Traditional simulation data saved to ${traditionalPath}`);
        
        // Blockchain-enabled simulation
        console.log("\n===== RUNNING BLOCKCHAIN-ENABLED SIMULATION =====\n");
        
        // Deploy a fresh contract for blockchain simulation
        const BeerDistributionGameBlockchain = await ethers.getContractFactory("BeerDistributionGame");
        const gameBlockchain = await BeerDistributionGameBlockchain.deploy();
        
        // Set initial inventory
        await gameBlockchain.setInitialInventory(12);
        await gameBlockchain.setShippingDelayPeriod(1);
        await gameBlockchain.setOrderDelayPeriod(0);
        
        // Set custom demand data BEFORE initializing game
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameBlockchain, customDemandData);
        }
        
        // Initialize game with owner
        await gameBlockchain.connect(owner).initializeGame(DemandPattern.CUSTOM);
        
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
        const blockchainPath = path.join(simDir, 'blockchain.json');
        fs.writeFileSync(blockchainPath, JSON.stringify(blockchainData, null, 2));
        console.log(`Blockchain simulation data saved to ${blockchainPath}`);
        
        // Calculate cost reduction and save summary
        const costReduction = traditionalCost - blockchainCost;
        const costReductionPercent = (costReduction / traditionalCost) * 100;
        
        console.log("\n===== SIMULATION SUMMARY =====");
        console.log(`Traditional Cost: ${traditionalCost}`);
        console.log(`Blockchain Cost: ${blockchainCost}`);
        
        // Calculate total player gas costs and system gas costs
        const playerGasCostUSD = blockchainData.reduce((sum, week) => 
            sum + week.gas.reduce((weekSum, gas) => weekSum + gas, 0), 0);
        const systemGasCostUSD = blockchainData.reduce((sum, week) => 
            sum + (week.systemGas || 0), 0);
        const totalGasCostUSD = playerGasCostUSD + systemGasCostUSD;
        
        console.log(`Blockchain Player Gas Costs: $${playerGasCostUSD.toFixed(2)}`);
        console.log(`Blockchain System Gas Costs: $${systemGasCostUSD.toFixed(2)}`);
        console.log(`Blockchain Total Gas Costs: $${totalGasCostUSD.toFixed(2)}`);
        console.log(`Blockchain Total (Operational + Gas): $${(blockchainCost + totalGasCostUSD).toFixed(2)}`);
        console.log(`Cost Reduction: ${costReduction} (${costReductionPercent.toFixed(2)}%)`);
        
        // Save summary to JSON file for easy integration with visualization
        const summaryObject = {
            DataSource: "zero_delay_simulation",
            Periods: periods,
            TraditionalCost: traditionalCost,
            BlockchainCost: blockchainCost,
            // Separate gas costs by player and system
            PlayerGasCostUSD: playerGasCostUSD,
            SystemGasCostUSD: systemGasCostUSD,
            TotalGasCostUSD: totalGasCostUSD,
            // Total cost including gas for reference
            BlockchainTotalWithGas: blockchainCost + totalGasCostUSD,
            // Operational cost reduction (excluding gas)
            CostReduction: costReduction,
            CostReductionPercent: costReductionPercent.toFixed(2)
        };
        
        const summaryPath = path.join(simDir, 'summary.json');
        fs.writeFileSync(summaryPath, JSON.stringify(summaryObject, null, 2));
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
