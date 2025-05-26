/**
 * Sterman Hybrid Factory Simulation for Beer Distribution Game
 * 
 * This script runs the beer distribution game simulation with the following approach:
 * - All roles use Sterman's heuristic policy
 * - End-customer demand comes from the sterman_scaled_fltocrocs_data.csv file
 * - In the blockchain scenario, only the factory uses blockchain visibility
 * - Retailer, wholesaler, and distributor don't participate in the blockchain network
 * 
 * Parameters:
 * - Order Delay: 1 week
 * - Shipping Delay: 2 weeks
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

// Arrays to store custom demand data from CSV
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
                // Extract customer demand from the "Rounded_Scaled_Units_at_49" column
                const customerDemand = parseInt(data['Rounded_Scaled_Units_at_49']) || 4;
                results.push(customerDemand);
            })
            .on('end', () => {
                console.log(`Loaded ${results.length} periods of customer demand data from ${filePath}`);
                console.log(`Sample demand values: ${results.slice(0, 5).join(', ')}...`);
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
 * @param {boolean} roleHasBlockchainVisibility - Whether this specific role uses the blockchain policy
 * @param {boolean} simulationIsBlockchainEnabled - True if the overall simulation is the blockchain-enabled variant
 * @returns {Object} - Data needed for order calculation
 */
async function getStermanOrderData(gameContract, role, roleHasBlockchainVisibility, simulationIsBlockchainEnabled) {
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
    
    // Get the last received order (for L_hat calculation in traditional mode)
    let lastReceivedOrder = 4; // default
    
    if (role === 0) { // Retailer
        try {
            const customerDemand = await gameContract.getCurrentCustomerDemand();
            lastReceivedOrder = toNumber(customerDemand);
        } catch (error) {
            console.error("Error getting customer demand for Retailer:", error);
        }
    } else {
        try {
            if (currentWeek > 0) {
                const downstreamOrder = await gameContract.getMemberOrderForWeek(role - 1, currentWeek - 1);
                lastReceivedOrder = toNumber(downstreamOrder);
            }
        } catch (error) {
            console.error(`Error getting downstream order for role ${role}:`, error);
        }
    }
    console.log(`Role ${role}: Last received order (for traditional L_hat) = ${lastReceivedOrder}`);
    
    const previous_L_hat = playerForecasts[role];
    
    let smoothedEndCustomerDemand = undefined;
    let currentEndCustomerDemandForLhat = 4; // Default for roles not using BC policy's L_hat

    // In hybrid mode, only the Factory (role 3) might use the blockchain policy.
    // It needs currentEndCustomerDemandForLhat.
    // Other roles use traditional policy, but we might still log smoothedEndCustomerDemand if simulationIsBlockchainEnabled.
    if (roleHasBlockchainVisibility && role === Role.FACTORY) { // Factory is using its blockchain policy
        try {
            // Fetch Distributor's order to Factory for the current week as the signal for L_hat_t
            const distributorOrderToFactory = await gameContract.getMemberOrderForWeek(Role.DISTRIBUTOR, currentWeek);
            currentEndCustomerDemandForLhat = toNumber(distributorOrderToFactory);
            console.log(`Factory (BC policy): Using Distributor's order to Factory (${currentEndCustomerDemandForLhat}) as currentEndCustomerDemandForLhat for L_hat_t`);

            // Fetch and log smoothed TRUE end-customer demand for comparison/logging
            const allTrueEndCustomerDemand = await gameContract.getCustomerDemand();
            const customerDemandHistory = allTrueEndCustomerDemand.map(d => toNumber(d)).slice(0, currentWeek + 1);
            if (customerDemandHistory.length > 0) {
                smoothedEndCustomerDemand = calculateMovingAverage(customerDemandHistory, 3);
                console.log(`Factory (BC policy): Smoothed TRUE end-customer demand (for logging): ${smoothedEndCustomerDemand.toFixed(2)}`);
                 if (customerDemandHistory.length > 1) {
                    const avg = customerDemandHistory.reduce((sum, d) => sum + d, 0) / customerDemandHistory.length;
                    const sumSquaredDiff = customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0);
                    const demandStdDev = Math.sqrt(sumSquaredDiff / customerDemandHistory.length);
                    console.log(`Factory (BC policy): TRUE End-customer demand history (for logging): ${customerDemandHistory.slice(-3).join(', ')}, StdDev: ${demandStdDev.toFixed(2)}`);
                }
            }
        } catch (error) {
            console.error(`Factory (BC policy): Error processing demand data:`, error);
            // If fetching distributor order fails, currentEndCustomerDemandForLhat remains 4 (default).
            // smoothedEndCustomerDemand might remain undefined or use fallback if primary fetch failed.
            if (smoothedEndCustomerDemand === undefined) smoothedEndCustomerDemand = currentEndCustomerDemandForLhat; 
        }
    } else if (simulationIsBlockchainEnabled) { 
        // This role is NOT using BC policy, but it's a BC-enabled simulation,
        // so end-customer demand data *might* be available for logging.
        try {
            const allDemand = await gameContract.getCustomerDemand();
            const customerDemandHistory = allDemand.map(d => toNumber(d)).slice(0, currentWeek + 1);
            if (customerDemandHistory.length > 0) {
                smoothedEndCustomerDemand = calculateMovingAverage(customerDemandHistory, 3);
                console.log(`Role ${role} (Trad policy in BC sim): Smoothed end-customer demand (for logging): ${smoothedEndCustomerDemand.toFixed(2)}`);
            }
        } catch (error) {
            // Silently fail or log minimally, as this is just for supplementary logging for traditional roles
            console.warn(`Role ${role} (Trad policy in BC sim): Could not fetch/smooth end-customer demand for logging.`);
        }
        // currentEndCustomerDemandForLhat remains its default (e.g., 4) as this role isn't using the BC L_hat formula.
    }
    
    return {
        onHand,
        backlog,
        onOrder,
        lastReceivedOrder,
        previous_L_hat,
        role,
        // This roleHasBlockchainVisibility tells stermanPolicy.calculateStermanBlockchainOrder if it should use the new L_hat
        hasBlockchainVisibility: roleHasBlockchainVisibility, 
        smoothedEndCustomerDemand, 
        currentEndCustomerDemandForLhat // Crucial for the new L_hat in blockchain mode
    };
}

/**
 * Place an order using Sterman's heuristic
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - The signer (player) who will place the order
 * @param {number} role - The role (0-3) for which to place the order
 * @param {boolean} roleIsBlockchainVisible - Whether this specific role uses the blockchain policy
 * @param {boolean} simulationIsBlockchainEnabled - True if the overall simulation is the blockchain-enabled variant
 * @returns {Object} - Order quantity and gas cost in USD
 */
async function placeStermanOrder(gameContract, signer, role, roleIsBlockchainVisible, simulationIsBlockchainEnabled) {
    console.log(`===== Placing Sterman order for ${roleToString(role)} =====`);
    
    // Determine if this specific role should use its blockchain-enhanced policy
    // In this hybrid simulation, only the Factory might.
    const useBlockchainPolicyForThisRole = roleIsBlockchainVisible && role === Role.FACTORY;

    // Get data: pass roleIsBlockchainVisible for the 'hasBlockchainVisibility' param of getStermanOrderData
    // and simulationIsBlockchainEnabled for the 'overallBlockchainMode' or equivalent.
    const orderData = await getStermanOrderData(gameContract, role, useBlockchainPolicyForThisRole, simulationIsBlockchainEnabled);
    
    let result;
    // The 'hasBlockchainVisibility' property within orderData will now correctly reflect
    // if this role is the factory AND is blockchain visible.
    if (orderData.hasBlockchainVisibility) { 
        result = stermanPolicy.calculateStermanBlockchainOrder(orderData);
    } else {
        result = stermanPolicy.calculateStermanOrder(orderData);
    }
    
    const orderQuantity = result.order;
    const updated_L_hat = result.updated_L_hat;
    
    // Store updated forecast for next week
    playerForecasts[role] = updated_L_hat;
    
    // Place the order in the game contract and capture gas
    const orderTx = await gameContract.connect(signer).placeOrder(orderQuantity, {
        gasPrice: INTENDED_GAS_PRICE_WEI
    });
    let orderGasUsd = 0;
    
    // Only track gas costs for factory when blockchain visibility is enabled
    if (useBlockchainPolicyForThisRole) {
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
 * @param {boolean} factoryIsBlockchainVisible - Whether the factory uses the blockchain policy
 * @param {boolean} simulationIsBlockchainEnabled - True if the overall simulation is the blockchain-enabled variant
 * @returns {Object} - Production quantity and gas cost in USD
 */
async function scheduleStermanProduction(gameContract, signer, factoryIsBlockchainVisible, simulationIsBlockchainEnabled) {
    console.log(`===== Scheduling Sterman production for Factory =====`);
    
    // Factory is always role 3.
    // The factoryIsBlockchainVisible parameter directly tells us if the factory should use its blockchain policy.
    const orderData = await getStermanOrderData(gameContract, Role.FACTORY, factoryIsBlockchainVisible, simulationIsBlockchainEnabled);
    
    let result;
    // The 'hasBlockchainVisibility' property in orderData is set by getStermanOrderData
    if (orderData.hasBlockchainVisibility) { // This will be true if factoryIsBlockchainVisible was true
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
    
    if (orderData.hasBlockchainVisibility) {
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
 * Run the game with Sterman's heuristic policy
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Array} signers - Array of signers for each role
 * @param {boolean} simulationIsBlockchainEnabled - True if the overall simulation is the blockchain-enabled variant
 * @param {number} demandPattern - Demand pattern to use (0-3)
 * @param {number} weeks - Number of weeks to simulate
 * @returns {Object} - Final cost and weekly data
 */
async function runGameWithStermanPolicy(gameContract, signers, simulationIsBlockchainEnabled, demandPattern = 0, weeks = 69) {
    console.log(`\n======= Starting Sterman ${simulationIsBlockchainEnabled ? 'Blockchain-Enabled' : 'Traditional'} Simulation for ${weeks} weeks =======\n`);
    
    // In traditional mode, don't track any gas costs
    console.log(`Gas tracking: ${simulationIsBlockchainEnabled ? 'Enabled (only for factory role)' : 'Disabled (no gas costs in traditional mode)'}`);
    if (!simulationIsBlockchainEnabled) {
        console.log('No transaction costs will be added to player costs in traditional mode');
    } else {
        console.log('Note: Only the factory uses blockchain visibility in this simulation');
    }
    
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
    const roleNames = ["Retailer", "Wholesaler", "Distributor", "Factory"];
    
    let previousTotalCosts = {
        0: 0, // Retailer
        1: 0, // Wholesaler
        2: 0, // Distributor
        3: 0  // Factory
    };
    
    // Try to run simulation for specified number of weeks
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
        
        // 1. Retailer places order to wholesaler - always use traditional approach
        let retailerOrder = 0;
        let retailerGasUsd = 0;
        try {
            const retailerRes = await placeStermanOrder(gameContract, signers[0], Role.RETAILER, false, simulationIsBlockchainEnabled);
            retailerOrder = retailerRes.orderQuantity;
            retailerGasUsd = retailerRes.gasUsd;
        } catch (error) {
            console.error(`Error placing retailer order: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // 2. Wholesaler places order to distributor - always use traditional approach
        let wholesalerOrder = 0;
        let wholesalerGasUsd = 0;
        try {
            const wholesalerRes = await placeStermanOrder(gameContract, signers[1], Role.WHOLESALER, false, simulationIsBlockchainEnabled);
            wholesalerOrder = wholesalerRes.orderQuantity;
            wholesalerGasUsd = wholesalerRes.gasUsd;
        } catch (error) {
            console.error(`Error placing wholesaler order: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // 3. Distributor places order to factory - always use traditional approach
        let distributorOrder = 0;
        let distributorGasUsd = 0;
        try {
            const distributorRes = await placeStermanOrder(gameContract, signers[2], Role.DISTRIBUTOR, false, simulationIsBlockchainEnabled);
            distributorOrder = distributorRes.orderQuantity;
            distributorGasUsd = distributorRes.gasUsd;
        } catch (error) {
            console.error(`Error placing distributor order: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // 4. Factory schedules production - use blockchain visibility if enabled
        let factoryOrder = 0;
        let factoryGasUsd = 0;
        try {
            const factoryRes = await scheduleStermanProduction(gameContract, signers[3], simulationIsBlockchainEnabled, simulationIsBlockchainEnabled);
            factoryOrder = factoryRes.orderQuantity;
            factoryGasUsd = factoryRes.gasUsd;
        } catch (error) {
            console.error(`Error scheduling factory production: ${error.message}`);
            if (error.message.includes("Game not active")) {
                console.log("Game has ended, exiting simulation loop.");
                break;
            }
        }
        
        // Process the week
        let processWeekGasUsd = 0;
        try {
            const processTx = await gameContract.connect(owner).processWeek({
                gasPrice: INTENDED_GAS_PRICE_WEI
            });
            
            // Only calculate gas if we're in blockchain mode, but don't distribute to players
            if (simulationIsBlockchainEnabled) {
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
            console.error(`Error processing week ${week}: ${error.message}`);
            if (error.message.includes("Game not active")) {
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
        
        console.log(`Week ${week} completed. Weekly operational cost: ${weekTotalCost}${simulationIsBlockchainEnabled ? `, Gas cost: ${weekTotalGasCost}` : ''}`);
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
        // Load custom demand data from footlocker_to_crocs_order_value_transformed_v2.csv
        const csvPath = path.resolve(__dirname, '../../footlocker_to_crocs_order_value_transformed_v2.csv');
        customDemandData = await loadCustomDemandData(csvPath);
        
        // Get signers for different roles
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        const gamePlayers = [retailer, wholesaler, distributor, factory];
        
        // Define DemandPattern enum values
        const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
        
        // Create a simulation-specific directory for this run
        const vizDir = path.join(__dirname, '../../visualization');
        const simDir = path.join(vizDir, 'data/simulations/sterman/hybrid-factory');
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
        
        // Set delay periods - One week order delay, two weeks shipping delay
        await gameTraditional.setOrderDelayPeriod(1);
        console.log("Order delay set to 1 week");
        
        await gameTraditional.setShippingDelayPeriod(2);
        console.log("Shipping delay set to 2 weeks");
        
        // Set custom demand data BEFORE initializing game
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameTraditional, customDemandData);
        }
        
        // Run traditional simulation
        const traditionalResult = await runGameWithStermanPolicy(
            gameTraditional,
            gamePlayers,
            false, // no blockchain visibility
            DemandPattern.CUSTOM, // Using custom demand pattern
            customDemandData.length > 0 ? customDemandData.length : 69
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
        
        // Set delay periods - One week order delay, two weeks shipping delay
        await gameBlockchain.setOrderDelayPeriod(1);
        console.log("Order delay set to 1 week");
        
        await gameBlockchain.setShippingDelayPeriod(2);
        console.log("Shipping delay set to 2 weeks");
        
        // Set custom demand data BEFORE initializing game
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameBlockchain, customDemandData);
        }
        
        // Run blockchain simulation
        const blockchainResult = await runGameWithStermanPolicy(
            gameBlockchain,
            gamePlayers,
            true, // with blockchain visibility
            DemandPattern.CUSTOM, // Using custom demand pattern
            customDemandData.length > 0 ? customDemandData.length : 69
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
        
        // Calculate total player gas costs and system gas costs
        const playerGasCostUSD = blockchainData.reduce((sum, week) => 
            sum + week.gas.reduce((weekSum, gas) => weekSum + gas, 0), 0);
        const systemGasCostUSD = blockchainData.reduce((sum, week) => 
            sum + (week.systemGas || 0), 0);
        const totalGasCostUSD = playerGasCostUSD + systemGasCostUSD;
        
        // Save summary to JSON file for easy integration with visualization
        const summaryObject = {
            DataSource: "hybrid_factory_simulation",
            Periods: customDemandData.length > 0 ? customDemandData.length : 69,
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
        
        console.log("\n===== SIMULATION SUMMARY =====");
        console.log(`Traditional Cost: ${traditionalCost}`);
        console.log(`Blockchain Cost: ${blockchainCost}`);
        console.log(`Blockchain Player Gas Costs: $${playerGasCostUSD.toFixed(2)}`);
        console.log(`Blockchain System Gas Costs: $${systemGasCostUSD.toFixed(2)}`);
        console.log(`Blockchain Total Gas Costs: $${totalGasCostUSD.toFixed(2)}`);
        console.log(`Blockchain Total (Operational + Gas): $${(blockchainCost + totalGasCostUSD).toFixed(2)}`);
        console.log(`Cost Reduction: ${costReduction} (${costReductionPercent.toFixed(2)}%)`);
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