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
const simplePolicy = require('../policies/simplePolicy');
const csv = require('csv-parser');

// USD price per ETH for on-chain gas calculations
const ETH_USD_PRICE = 2500;
// Intended gas price for all simulation transactions (20 Gwei)
const INTENDED_GAS_PRICE_GWEI = "20";
const INTENDED_GAS_PRICE_WEI = ethers.parseUnits(INTENDED_GAS_PRICE_GWEI, "gwei");

// DEMAND_SCALING_FACTOR is no longer needed as we are only using integers.
// const DEMAND_SCALING_FACTOR = 10;

// Player forecasts (L_hat_t) for the adaptive expectations model
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
                // Extract customer demand as integer from the "Rounded_Scaled_Units_at_51.46" column
                const customerDemand = parseInt(data['Mixed_51_46']) || 4;
                results.push(customerDemand);
            })
            .on('end', () => {
                console.log(`Loaded ${results.length} periods of custom demand data from ${filePath}`);
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
        // Demand data is already an array of integers, no scaling needed.
        console.log(`Integer demand sample: ${demandData.slice(0,3).join(', ')}`);
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
        return parseInt(value.toString()); // Ensure integer output
    }
    
    // Check if it's a native BigInt
    if (typeof value === 'bigint') {
        return Number(value);
    }
    
    // If it's already a number, ensure it's an integer for policy input
    if (typeof value === 'number') {
        return Math.round(value); // Or Math.floor / Math.ceil depending on desired behavior
    }
    
    // Try to convert strings to numbers then to integers
    if (typeof value === 'string') {
        return Math.round(Number(value));
    }
    
    // Default case - attempt to convert or return 0
    try {
        return Math.round(Number(value));
    } catch (e) {
        console.error("Could not convert value to number:", value);
        return 0;
    }
}

/**
 * Get necessary game data for the Simple Policy order calculation.
 * All demand values returned for policy input will be integers.
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {number} role - The role (0-3) for which to calculate the order
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @returns {Object} - Data needed for order calculation { currentInventory, currentBacklog, lastReceivedOrder, currentEndCustomerDemandForLhat, previous_L_hat }
 */
async function getSimplePolicyData(gameContract, role, hasBlockchainVisibility) {
    const memberData = await gameContract.getMemberData(role);
    const currentInventory = toNumber(memberData[0]); // OnHand inventory
    const currentBacklog = toNumber(memberData[1]); // Backlog
    const previous_L_hat = playerForecasts[role]; // Get L_hat from previous period for this role

    // const currentWeek = toNumber(await gameContract.currentWeek()); // Not strictly needed for policy inputs here

    let lastReceivedOrder = 0; // For traditional policy
    let currentEndCustomerDemandForLhat = 0; // For blockchain policy L_hat calculation

    if (hasBlockchainVisibility) {
        // Blockchain policy uses current end-customer demand for its L_hat calculation
        const rawEndCustomerDemand = await gameContract.getCurrentCustomerDemand();
        currentEndCustomerDemandForLhat = toNumber(rawEndCustomerDemand);
        console.log(`Role ${roleToString(role)} (Blockchain): Inv=${currentInventory}, Backlog=${currentBacklog}, CEDemandForLhat=${currentEndCustomerDemandForLhat}, PrevLhat=${previous_L_hat.toFixed(2)}`);
    } else {
        // Traditional policy
        // Retailer's lastReceivedOrder is the current customer demand for this week
        if (role === Role.RETAILER) {
            const rawCustomerDemand = await gameContract.getCurrentCustomerDemand();
            lastReceivedOrder = toNumber(rawCustomerDemand);
        } else {
            // Other roles' lastReceivedOrder is what they actually received from downstream, which is memberData[3]
            lastReceivedOrder = toNumber(memberData[3]); // memberData[3] is lastOrderReceived
        }
        console.log(`Role ${roleToString(role)} (Traditional): Inv=${currentInventory}, Backlog=${currentBacklog}, LastRcvdOrder=${lastReceivedOrder}, PrevLhat=${previous_L_hat.toFixed(2)}`);
    }
    
    return {
        currentInventory,
        currentBacklog,
        lastReceivedOrder, // Used by traditional policy
        currentEndCustomerDemandForLhat, // Used by blockchain policy for L_hat
        previous_L_hat
    };
}

/**
 * Place an order using the Simple Policy
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - The signer (player) who will place the order
 * @param {number} role - The role (0-3) for which to place the order
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 */
async function placeSimplePolicyOrder(gameContract, signer, role, hasBlockchainVisibility) {
    console.log(`===== Placing Simple Policy order for ${roleToString(role)} =====`);
    
    const policyData = await getSimplePolicyData(gameContract, role, hasBlockchainVisibility);
    
    let orderResult;
    if (hasBlockchainVisibility) {
        orderResult = simplePolicy.calculateSimpleBlockchainOrder(policyData);
    } else {
        orderResult = simplePolicy.calculateSimpleTraditionalOrder(policyData);
    }
    
    const orderQuantity = orderResult.orderQuantity;
    playerForecasts[role] = orderResult.updated_L_hat; // Update the forecast for the next period

    const orderTx = await gameContract.connect(signer).placeOrder(orderQuantity, {
        gasPrice: INTENDED_GAS_PRICE_WEI
    });
    let orderGasUsd = 0;
    if (hasBlockchainVisibility) {
        try {
            const orderReceipt = await orderTx.wait();
            if (orderReceipt && orderReceipt.gasUsed != null) {
                const gasUsedBigInt = BigInt(orderReceipt.gasUsed.toString());
                const gasPriceBigInt = BigInt(INTENDED_GAS_PRICE_WEI.toString());
                const gasCostWei = gasUsedBigInt * gasPriceBigInt;
                const gasCostWeiStr = gasCostWei.toString();
                let gasCostEth;
                if (gasCostWeiStr.length <= 18) {
                    gasCostEth = parseFloat("0." + "0".repeat(18 - gasCostWeiStr.length) + gasCostWeiStr);
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
            await orderTx.wait(); 
            console.log(`${roleToString(role)} placed order of ${orderQuantity} units (Gas calculation failed)`);
        }
    } else {
        await orderTx.wait();
        console.log(`${roleToString(role)} placed order of ${orderQuantity} units`);
    }
    // No forecast to update for simple policy

    return { orderQuantity, gasUsd: orderGasUsd };
}

/**
 * Schedule production using the Simple Policy (for Factory role)
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - The signer (factory) who will schedule production
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 */
async function scheduleSimplePolicyProduction(gameContract, signer, hasBlockchainVisibility) {
    console.log(`===== Scheduling Simple Policy production for Factory =====`);
    
    // Factory uses the same logic as other roles for this simple policy
    const policyData = await getSimplePolicyData(gameContract, Role.FACTORY, hasBlockchainVisibility);
    
    let productionResult;
    if (hasBlockchainVisibility) {
        productionResult = simplePolicy.calculateSimpleBlockchainOrder(policyData);
    } else {
        productionResult = simplePolicy.calculateSimpleTraditionalOrder(policyData);
    }
        
    const productionQuantity = productionResult.orderQuantity;
    playerForecasts[Role.FACTORY] = productionResult.updated_L_hat; // Update factory's forecast

    const prodTx = await gameContract.connect(signer).scheduleProduction(productionQuantity, {
        gasPrice: INTENDED_GAS_PRICE_WEI
    });
    let prodGasUsd = 0;
    if (hasBlockchainVisibility) {
        try {
            const prodReceipt = await prodTx.wait();
            if (prodReceipt && prodReceipt.gasUsed != null) {
                const gasUsedBigInt = BigInt(prodReceipt.gasUsed.toString());
                const gasPriceBigInt = BigInt(INTENDED_GAS_PRICE_WEI.toString());
                const gasCostWei = gasUsedBigInt * gasPriceBigInt;
                const gasCostWeiStr = gasCostWei.toString();
                let gasCostEth;
                if (gasCostWeiStr.length <= 18) {
                    gasCostEth = parseFloat("0." + "0".repeat(18 - gasCostWeiStr.length) + gasCostWeiStr);
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
            await prodTx.wait(); 
            console.log(`Factory scheduled production of ${productionQuantity} units (Gas calculation failed)`);
        }
    } else {
        await prodTx.wait();
        console.log(`Factory scheduled production of ${productionQuantity} units`);
    }
    // No forecast to update for simple policy

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
 * Run the game with the Simple Policy
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Array} signers - Array of signers for each role
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @param {number} demandPattern - Demand pattern to use (0-3)
 * @param {number} weeks - Number of weeks to simulate
 * @param {Signer} owner - The owner/admin signer for processing weeks.
 * @returns {Object} - Final cost and weekly data
 */
async function runGameWithSimplePolicy(gameContract, signers, hasBlockchainVisibility, demandPattern = 0, weeks = 69, owner) {
    console.log(`\n======= Starting Simple Policy ${hasBlockchainVisibility ? 'Blockchain-Enabled' : 'Traditional'} Simulation for ${weeks} weeks =======\n`);
    
    // Reset player forecasts at the beginning of each simulation run
    for (let roleId = 0; roleId < 4; roleId++) {
        playerForecasts[roleId] = 4; // Initialize to a default value (e.g., 4)
    }
    
    if (!hasBlockchainVisibility) {
        console.log('Gas tracking: Disabled. No transaction costs will be added to player costs in traditional mode');
    } else {
        console.log('Gas tracking: Enabled (only for blockchain roles)');
    }
    
    const weeklyData = [];
    let previousTotalCosts = { 0: 0, 1: 0, 2: 0, 3: 0 };
    
    for (let week = 0; week < weeks; week++) {
        console.log(`\nProcessing Week ${week}`);
        
        let customerDemandForLogging;
        try {
            const rawDemand = await gameContract.getCurrentCustomerDemand();
            customerDemandForLogging = toNumber(rawDemand); // Already integer
            console.log(`Customer demand for week ${week}: ${customerDemandForLogging}`);
        } catch (error) {
            console.log("Could not get customer demand for this week.");
            customerDemandForLogging = "Unknown";
        }
        
        let retailerOrder = 0, retailerGasUsd = 0;
        try {
            const res = await placeSimplePolicyOrder(gameContract, signers[0], Role.RETAILER, hasBlockchainVisibility);
            retailerOrder = res.orderQuantity;
            retailerGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error placing retailer order: ${error.message}`);
        }
        
        let wholesalerOrder = 0, wholesalerGasUsd = 0;
        try {
            const res = await placeSimplePolicyOrder(gameContract, signers[1], Role.WHOLESALER, hasBlockchainVisibility);
            wholesalerOrder = res.orderQuantity;
            wholesalerGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error placing wholesaler order: ${error.message}`);
        }
        
        let distributorOrder = 0, distributorGasUsd = 0;
        try {
            const res = await placeSimplePolicyOrder(gameContract, signers[2], Role.DISTRIBUTOR, hasBlockchainVisibility);
            distributorOrder = res.orderQuantity;
            distributorGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error placing distributor order: ${error.message}`);
        }
        
        let factoryOrder = 0, factoryGasUsd = 0;
        try {
            const res = await scheduleSimplePolicyProduction(gameContract, signers[3], hasBlockchainVisibility);
            factoryOrder = res.orderQuantity;
            factoryGasUsd = res.gasUsd;
        } catch (error) {
            console.error(`Error scheduling factory production: ${error.message}`);
        }
        
        // Process the week (this handles all the mechanics, deliveries, and phase transitions)
        let processWeekGasUsd = 0;
        try {
            const processTx = await gameContract.connect(owner).processWeek({
                gasPrice: INTENDED_GAS_PRICE_WEI
            });
            if (hasBlockchainVisibility) {
                try {
                    const processReceipt = await processTx.wait();
                    if (processReceipt && processReceipt.gasUsed != null) {
                        const gasUsedBigInt = BigInt(processReceipt.gasUsed.toString());
                        const gasPriceBigInt = BigInt(INTENDED_GAS_PRICE_WEI.toString());
                        const gasCostWei = gasUsedBigInt * gasPriceBigInt;
                        const gasCostWeiStr = gasCostWei.toString();
                        let gasCostEth;
                        if (gasCostWeiStr.length <= 18) {
                            gasCostEth = parseFloat("0." + "0".repeat(18 - gasCostWeiStr.length) + gasCostWeiStr);
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
        const csvPath = path.resolve(__dirname, '../../5pricepoints.csv');
        customDemandData = await loadCustomDemandData(csvPath); 
        
        const periods = customDemandData.length > 0 ? customDemandData.length : 69;
        console.log(`Will simulate ${periods} periods using custom demand data`);
        
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        const gamePlayers = [retailer, wholesaler, distributor, factory];
        
        const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2, CUSTOM: 3 };
        
        const vizDir = path.join(__dirname, '../../visualization');
        if (!fs.existsSync(vizDir)) fs.mkdirSync(vizDir, { recursive: true });
        const simDirName = '1-2-49-simulation'; // New directory for these results, named after the script
        const simDir = path.join(vizDir, 'data/simulations/sterman/', simDirName); 
        if (!fs.existsSync(simDir)) fs.mkdirSync(simDir, { recursive: true });
        
        console.log("\n===== RUNNING TRADITIONAL SIMULATION (SIMPLE POLICY - INTEGER) =====\n");
        const BeerDistributionGameTraditional = await ethers.getContractFactory("contracts/BeerDistributionGame.sol:BeerDistributionGame");
        const gameTraditional = await BeerDistributionGameTraditional.deploy();
        await gameTraditional.setInitialInventory(1500000);
        
        // Set delay periods - One week order delay, two weeks shipping delay
        await gameTraditional.setOrderDelayPeriod(1);
        console.log("Order delay set to 1 week");
        
        await gameTraditional.setShippingDelayPeriod(2);
        console.log("Shipping delay set to 2 weeks");
        
        // Set custom demand data
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameTraditional, customDemandData);
        }

        // Initialize game HERE
        await gameTraditional.connect(owner).initializeGame(DemandPattern.CUSTOM);
        console.log("Traditional game initialized.");

        // Assign players
        for (let i = 0; i < 4; i++) {
            await gameTraditional.connect(owner).assignPlayer(gamePlayers[i].address, i);
        }
        console.log("Traditional players assigned.");

        // Verify initial inventory for Retailer in traditional game
        const traditionalRetailerData = await gameTraditional.getMemberData(Role.RETAILER);
        console.log(`Traditional Retailer Initial Inventory: ${toNumber(traditionalRetailerData[0])}`);

        // Run traditional simulation
        const traditionalResult = await runGameWithSimplePolicy(
            gameTraditional,
            gamePlayers,
            false, // no blockchain visibility
            DemandPattern.CUSTOM, // This argument is now effectively unused by runGameWithSimplePolicy for initialization
            periods,
            owner // Pass owner
        );
        const traditionalCost = traditionalResult.finalCost;
        const traditionalData = traditionalResult.weeklyData;
        
        // Save traditional data
        const traditionalPath = path.join(simDir, 'traditional.json');
        fs.writeFileSync(traditionalPath, JSON.stringify(traditionalData, null, 2));
        console.log(`Traditional simulation data saved to ${traditionalPath}`);
        
        // Blockchain-enabled simulation
        console.log("\n===== RUNNING BLOCKCHAIN-ENABLED SIMULATION (SIMPLE POLICY - INTEGER) =====\n");
        // For a true integer-only blockchain run, we'd use BeerDistributionGame.sol here as well.
        // If BeerDistributionGameFloat.sol is used, it expects scaled integers if DEMAND_SCALING_FACTOR was defined in it.
        // Since we want pure integers everywhere, use the standard contract.
        const BeerDistributionGameBlockchain = await ethers.getContractFactory("contracts/BeerDistributionGame.sol:BeerDistributionGame"); 
        const gameBlockchain = await BeerDistributionGameBlockchain.deploy();
        await gameBlockchain.setInitialInventory(1500000);
        
        // Set delay periods - One week order delay, two weeks shipping delay
        await gameBlockchain.setOrderDelayPeriod(1);
        console.log("Order delay set to 1 week");
        
        await gameBlockchain.setShippingDelayPeriod(2);
        console.log("Shipping delay set to 2 weeks");
        
        // Set custom demand data
        if (customDemandData.length > 0) {
            await setCustomDemandData(gameBlockchain, customDemandData);
        }

        // Initialize game HERE
        await gameBlockchain.connect(owner).initializeGame(DemandPattern.CUSTOM);
        console.log("Blockchain game initialized.");

        // Assign players
        for (let i = 0; i < 4; i++) {
            await gameBlockchain.connect(owner).assignPlayer(gamePlayers[i].address, i);
        }
        console.log("Blockchain players assigned.");

        // Verify initial inventory for Retailer in blockchain game
        const blockchainRetailerData = await gameBlockchain.getMemberData(Role.RETAILER);
        console.log(`Blockchain Retailer Initial Inventory: ${toNumber(blockchainRetailerData[0])}`);
        
        // Run blockchain simulation
        const blockchainResult = await runGameWithSimplePolicy(
            gameBlockchain,
            gamePlayers,
            true, // with blockchain visibility
            DemandPattern.CUSTOM, // This argument is now effectively unused by runGameWithSimplePolicy for initialization
            periods,
            owner // Pass owner
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
            DataSource: "two_shipping_delay_simulation",
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