/**
 * Hybrid Retailer Policy Script for Beer Distribution Game
 * 
 * This script runs the beer distribution game simulation using real-world order flow data
 * from the Std_Order_Quantities.csv file for customer demand and retailer orders,
 * while the upstream players (Wholesaler, Distributor, Factory) use the algorithmic policy.
 * 
 * The simulation can be run with or without blockchain visibility for the algorithmic players.
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
 * Read order flow data from CSV file
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
                
                // Only push valid numbers
                if (!isNaN(customerDemand) && !isNaN(retailerOrder)) {
                    // Scale down to appropriate range for simulation (optional - adjust if needed)
                    const scaledDemand = Math.round(customerDemand);
                    const scaledOrder = Math.round(retailerOrder);
                    
                    results.push({
                        customerDemand: scaledDemand,
                        retailerOrder: scaledOrder
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
                        console.log(`  Period ${i+1}: Customer Demand = ${results[i].customerDemand}, Retailer Order = ${results[i].retailerOrder}`);
                    }
                    resolve(results);
                }
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

/**
 * Get necessary game data for order calculation
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {number} role - The role (0-3) for which to calculate the order
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @returns {Object} - Data needed for order calculation
 */
async function getOrderData(gameContract, role, hasBlockchainVisibility) {
    try {
        // Get member data from member information
        const memberData = await gameContract.getMemberData(role);
        const onHand = toNumber(memberData[0]);
        const backlog = toNumber(memberData[1]);
        
        // Get current week
        const currentWeek = toNumber(await gameContract.currentWeek());
        
        // Get lead time based on contract parameters
        const orderDelay = await gameContract.orderDelayPeriod();
        const shippingDelay = await gameContract.shippingDelayPeriod();
        const leadTime = toNumber(orderDelay) + toNumber(shippingDelay);
        
        // Get the shipment pipeline for this role to calculate on-order inventory correctly
        let onOrder = 0;
        try {
            // The on-order inventory is the sum of all items in the shipment pipeline
            // This is all shipments dispatched by the supplier but not yet arrived
            const shipmentPipeline = await gameContract.getShipmentPipeline(role);
            onOrder = shipmentPipeline.reduce((sum, shipment) => sum + toNumber(shipment), 0);
            console.log(`Role ${role}: Calculated on-order from shipment pipeline: ${onOrder} units`);
        } catch (error) {
            console.error(`Error getting shipment pipeline for role ${role}:`, error);
            // Fall back to a default or 0 if we can't get the pipeline
            onOrder = 0;
        }
        
        // Get the order pipeline to display for debugging
        let orderPipeline = [];
        try {
            const contractOrderPipeline = await gameContract.getOrderPipeline(role);
            orderPipeline = contractOrderPipeline.map(order => toNumber(order));
            console.log(`Order pipeline for role ${role}: [${orderPipeline.join(', ')}]`);
        } catch (error) {
            console.error(`Error getting order pipeline for role ${role}:`, error);
        }
        
        // Get the shipment pipeline to display for debugging
        let shipmentPipeline = [];
        try {
            const contractShipmentPipeline = await gameContract.getShipmentPipeline(role);
            shipmentPipeline = contractShipmentPipeline.map(shipment => toNumber(shipment));
            console.log(`Shipment pipeline for role ${role}: [${shipmentPipeline.join(', ')}]`);
        } catch (error) {
            console.error(`Error getting shipment pipeline for role ${role}:`, error);
        }
        
        // Previous orders data
        let previousOrders = [];
        for (let i = Math.max(0, currentWeek - 10); i < currentWeek; i++) {
            try {
                const order = await gameContract.getMemberOrderForWeek(role, i);
                previousOrders.push(toNumber(order));
            } catch (error) {
                // If order doesn't exist for this week, push 0
                previousOrders.push(0);
            }
        }
        
        // Get demand pattern
        const selectedDemandPattern = await gameContract.selectedDemandPattern();
            
        // Variables for demand information
        let endCustomerDemand = 4; // Default
        let smoothedEndCustomerDemand = 4; // Default, will be calculated
        let demandStdDev = 0; // Default (no variability for constant demand)
        
        // Get customer demand history for variability calculation
        let customerDemandHistory = [];
        
        // Calculate received order history
        let incomingOrdersHistory = [];
        let receivedAvgDemand = 4; // Default value, will be adjusted below
        
        // Always retrieve end-customer demand if blockchain visibility is enabled
        // This information will be available to all roles in the blockchain scenario
        if (hasBlockchainVisibility || role === Role.RETAILER) {
            try {
                // Try to get customer demand for current week
                const customerDemand = await gameContract.getCurrentCustomerDemand();
                endCustomerDemand = toNumber(customerDemand);
                
                // Get all customer demand data available
                const allDemand = await gameContract.getCustomerDemand();
                
                // Convert to an array of numbers and slice to get history up to current week
                customerDemandHistory = allDemand.map(d => toNumber(d)).slice(0, currentWeek + 1);
                
                if (customerDemandHistory.length > 1) {
                    // Calculate moving average of end-customer demand (over last 3 weeks or all if fewer)
                    smoothedEndCustomerDemand = calculateMovingAverage(customerDemandHistory, 3);
                    console.log(`Calculated SMOOTHED end-customer demand: ${smoothedEndCustomerDemand.toFixed(2)} (using last ${Math.min(3, customerDemandHistory.length)} weeks)`);
                    
                    // Calculate standard deviation
                    const avg = customerDemandHistory.reduce((sum, d) => sum + d, 0) / customerDemandHistory.length;
                    const sumSquaredDiff = customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0);
                    demandStdDev = Math.sqrt(sumSquaredDiff / customerDemandHistory.length);
                    
                    console.log(`End-customer demand history: ${customerDemandHistory.join(', ')}`);
                    console.log(`End-customer demand std dev: ${demandStdDev.toFixed(2)}`);
                } else {
                    // For week 0, use a reasonable default
                    smoothedEndCustomerDemand = endCustomerDemand;
                    demandStdDev = 1.0; // Reasonable default for early weeks
                }
                
                console.log(`Using customer demand: ${endCustomerDemand}`);
                console.log(`Using SMOOTHED customer demand for calculations: ${smoothedEndCustomerDemand.toFixed(2)}`);
            } catch (error) {
                console.log(`Could not get customer demand, using default value`);
            }
        }
        
        // For the retailer, incoming orders = customer demand
        if (role === Role.RETAILER) {
            incomingOrdersHistory = [...customerDemandHistory]; // Use customer demand as incoming orders
            receivedAvgDemand = smoothedEndCustomerDemand; // Set received demand to customer demand for retailer
        } else {
            // For non-retailer roles, get orders placed by their downstream role (orders received)
            const downstreamRole = role - 1; // Get the downstream role
            
            // Get the downstream role's order history (which are orders RECEIVED by this role)
            for (let i = Math.max(0, currentWeek - 10); i < currentWeek; i++) {
                try {
                    // Get orders placed BY the downstream role (orders RECEIVED by this role)
                    const receivedOrder = await gameContract.getMemberOrderForWeek(downstreamRole, i);
                    incomingOrdersHistory.push(toNumber(receivedOrder));
                } catch (error) {
                    // If order doesn't exist for this week, push 0
                    incomingOrdersHistory.push(0);
                }
            }
            
            // Calculate average of orders RECEIVED
            if (incomingOrdersHistory.length > 0 && incomingOrdersHistory.some(o => o > 0)) {
                const nonZeroOrders = incomingOrdersHistory.filter(o => o > 0);
                receivedAvgDemand = nonZeroOrders.reduce((sum, order) => sum + order, 0) / nonZeroOrders.length;
                
                // Calculate standard deviation for all non-retailer roles
                if (nonZeroOrders.length > 1) {
                    const localAvg = receivedAvgDemand;
                    const localSumSqDiff = nonZeroOrders.reduce((sum, o) => sum + Math.pow(o - localAvg, 2), 0);
                    const localStdDev = Math.sqrt(localSumSqDiff / nonZeroOrders.length);
                    console.log(`Role ${role} - Calculated LOCAL stdDev: ${localStdDev.toFixed(2)} from received orders`);
                    
                    // Initialize orderData early to avoid reference error
                    let orderData = {};
                    orderData.localDemandStdDev = localStdDev;
                }
            } else if (currentWeek === 0) {
                // For week 0, use reasonable defaults
                receivedAvgDemand = 4; // Default for week 0
                console.log(`[COLD START] Role ${role} - Using default avgDemand: ${receivedAvgDemand}`);
            }
            
            // Log the data
            const logPrefix = hasBlockchainVisibility ? '[BLOCKCHAIN]' : '[TRADITIONAL]';
            console.log(`${logPrefix} Role ${role} - Using avgDemand from RECEIVED orders: ${receivedAvgDemand}`);
            console.log(`${logPrefix} Role ${role} - Incoming orders history: [${incomingOrdersHistory.join(', ')}]`);
        }
        
        // Basic order data that's always available
        let orderData = {
            role,
            onHand,
            backlog,
            onOrder,
            currentWeek,
            weekNum: currentWeek,
            previousOrders, // Keep for backward compatibility
            incomingOrdersHistory, // Add the new incoming orders history
            leadTime,
            serviceLevel: 0.97, // High service level for safety stock
            selectedDemandPattern: toNumber(selectedDemandPattern)
        };
        
        // Set avgDemand based on visibility mode, not just role
        // In blockchain mode, all players use end customer demand
        // In traditional mode, each player uses their local received order data
        if (hasBlockchainVisibility) {
            orderData.avgDemand = smoothedEndCustomerDemand;
            orderData.demandStdDev = demandStdDev;
            console.log(`[BLOCKCHAIN] Role ${role} - Using END CUSTOMER smoothed demand for calculations: ${smoothedEndCustomerDemand.toFixed(2)}`);
        } else {
            orderData.avgDemand = role === Role.RETAILER ? smoothedEndCustomerDemand : receivedAvgDemand;
            orderData.demandStdDev = role === Role.RETAILER ? demandStdDev : orderData.localDemandStdDev || 0;
        }
        
        // Add end-customer demand data when blockchain visibility is enabled
        if (hasBlockchainVisibility) {
            orderData.endCustomerDemand = endCustomerDemand;
            orderData.smoothedEndCustomerDemand = smoothedEndCustomerDemand;
            orderData.customerDemandHistory = customerDemandHistory;
        }
        
        // Add blockchain visibility data when enabled
        if (hasBlockchainVisibility && role > 0) {
            orderData.hasBlockchainVisibility = true;
            
            // Get downstream customer data
            const downstreamRole = role - 1;
            const downstreamData = await gameContract.getMemberData(downstreamRole);
            
            // Calculate downstream on-order correctly from shipment pipeline
            let downstreamOnOrder = 0;
            try {
                const downstreamShipmentPipeline = await gameContract.getShipmentPipeline(downstreamRole);
                downstreamOnOrder = downstreamShipmentPipeline.reduce((sum, shipment) => sum + toNumber(shipment), 0);
            } catch (error) {
                console.error(`Error getting shipment pipeline for downstream role ${downstreamRole}:`, error);
                downstreamOnOrder = 0;
            }
            
            orderData.downstreamData = {
                role: downstreamRole,
                onHand: toNumber(downstreamData[0]),
                backlog: toNumber(downstreamData[1]),
                onOrder: downstreamOnOrder
            };
            
            // Calculate downstream inventory position
            orderData.downstreamIP = orderData.downstreamData.onHand + 
                                     orderData.downstreamData.onOrder - 
                                     orderData.downstreamData.backlog;
            
            // Calculate downstream target using end-customer demand data
            // Base stock level calculation for downstream
            const isConstantDemand = orderData.selectedDemandPattern === 0;
            
            // Use global end-customer demand for downstream's target with blockchain visibility
            const downstreamAvgDemand = smoothedEndCustomerDemand;
            
            // Get appropriate safety factor for service level
            const serviceLevel = orderData.serviceLevel || 0.97;
            let safetyFactor;
            
            if (serviceLevel <= 0.84) {
                safetyFactor = 1.0; // Approx for 84%
            } else if (serviceLevel <= 0.95) {
                safetyFactor = 1.65; // Approx for 95%
            } else if (serviceLevel <= 0.975) {
                safetyFactor = 1.96; // Approx for 97.5%
            } else if (serviceLevel <= 0.99) {
                safetyFactor = 2.33; // Approx for 99%
            } else {
                safetyFactor = 2.58; // Approx for 99.5%+
            }
            
            // Base component: downstream average demand * lead time
            let downstreamTarget = downstreamAvgDemand * leadTime;
            
            // Add safety stock for non-constant demand
            if (!isConstantDemand) {
                // Use global std dev for downstream's target
                const safetyStock = safetyFactor * demandStdDev * Math.sqrt(leadTime);
                downstreamTarget += safetyStock;
                
                console.log(`Adding downstream safety stock of ${safetyStock.toFixed(2)} units (demandStdDev: ${demandStdDev.toFixed(2)}, leadTime: ${leadTime})`);
            }
            
            orderData.downstreamS = downstreamTarget;
            
            console.log(`Downstream data - Role: ${downstreamRole}, IP: ${orderData.downstreamIP}, S: ${orderData.downstreamS.toFixed(2)}`);
            console.log(`Using GLOBAL end-customer demand for downstream target calculation: Avg=${smoothedEndCustomerDemand.toFixed(2)}, StdDev=${demandStdDev.toFixed(2)}`);
        }
        
        // Log inventory positions for clarity
        console.log(`[Week ${currentWeek}] PRE-DECISION State for Role ${role} (${roleToString(role)}):`);
        console.log(`           On Hand: ${onHand}`);
        console.log(`           On Order: ${onOrder}`);
        console.log(`           Backlog: ${backlog}`);
        console.log(`           Inventory Position: ${onHand + onOrder - backlog}`);
        
        return orderData;
    } catch (error) {
        console.error(`Error in getOrderData for role ${role}:`, error);
        throw error;
    }
}

/**
 * Utility function to convert role number to string
 * 
 * @param {number} role - Role number
 * @returns {string} - Role name
 */
function roleToString(role) {
    switch (role) {
        case Role.RETAILER: return "Retailer";
        case Role.WHOLESALER: return "Wholesaler";
        case Role.DISTRIBUTOR: return "Distributor";
        case Role.FACTORY: return "Factory";
        default: return "Unknown";
    }
}

/**
 * Place an algorithmic order for a specific role based on the policy
 * 
 * @param {Contract} gameContract - The BeerDistributionGame contract
 * @param {object} signer - The signer for the role
 * @param {number} role - The role (1-3)
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @returns {Promise<object>} - Order data including amount
 */
async function placeAlgorithmicOrder(gameContract, signer, role, hasBlockchainVisibility) {
    try {
        // Get order data
        const orderData = await getOrderData(gameContract, role, hasBlockchainVisibility);
        
        // Calculate the order using the order policy
        const orderAmount = orderPolicy.calculateOrder(orderData);
        
        // Place the order
        const tx = await gameContract.connect(signer).placeOrder(orderAmount);
        await tx.wait();
        
        // Log for debugging
        console.log(`Role ${role} (${roleToString(role)}) placing algorithmic order of ${orderAmount} units`);
        
        return { amount: orderAmount, algorithmicAmount: orderAmount };
    } catch (error) {
        console.error(`Error in placeAlgorithmicOrder for role ${role}:`, error);
        throw error;
    }
}

/**
 * Place a fixed order for the retailer based on CSV data
 * 
 * @param {Contract} gameContract - The BeerDistributionGame contract
 * @param {object} signer - The signer for the retailer
 * @param {number} orderAmount - The fixed order amount from CSV
 * @returns {Promise<object>} - Order data including amount
 */
async function placeFixedRetailerOrder(gameContract, signer, orderAmount) {
    try {
        // Get order data just for logging (we won't use it to calculate the order)
        const orderData = await getOrderData(gameContract, Role.RETAILER, false);
        
        // The order amount is pre-determined from CSV
        // Place the order
        const tx = await gameContract.connect(signer).placeOrder(orderAmount);
        await tx.wait();
        
        // Log for debugging
        console.log(`Retailer placing FIXED order of ${orderAmount} units from CSV data`);
        
        // Calculate what the algorithmic amount would have been (for comparison)
        const algorithmicAmount = orderPolicy.calculateOrder(orderData);
        console.log(`For comparison: Algorithmic policy would have ordered ${algorithmicAmount} units`);
        
        return { amount: orderAmount, algorithmicAmount: algorithmicAmount };
    } catch (error) {
        console.error(`Error in placeFixedRetailerOrder:`, error);
        throw error;
    }
}

/**
 * Schedule production for the factory based on the policy
 * 
 * @param {Contract} gameContract - The BeerDistributionGame contract
 * @param {object} signer - The signer for the factory
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @returns {Promise<object>} - Production data including amount
 */
async function scheduleProduction(gameContract, signer, hasBlockchainVisibility) {
    try {
        // Get order data for factory (role 3)
        const factoryData = await getOrderData(gameContract, Role.FACTORY, hasBlockchainVisibility);
        
        // Calculate the production amount using the order policy
        const productionAmount = orderPolicy.calculateProduction(factoryData);
        
        // Schedule the production
        const tx = await gameContract.connect(signer).scheduleProduction(productionAmount);
        await tx.wait();
        
        // Log for debugging
        console.log(`Factory scheduling production of ${productionAmount} units`);
        
        return { amount: productionAmount };
    } catch (error) {
        console.error(`Error in scheduleProduction:`, error);
        throw error;
    }
}

// Helper to get phase name from number
function phaseToString(phase) {
    const phases = ["WEEK_START", "AFTER_SHIPMENTS", "AFTER_ORDERS", "WEEK_END"];
    return phases[phase] || "UNKNOWN";
}

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
 * Run the game simulation with hybrid policy:
 * - Fixed order data from CSV for customer demand and retailer
 * - Algorithmic policy for wholesaler, distributor, and factory
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer[]} signers - Array of signers for each role
 * @param {Array} orderFlowData - Array of order data from CSV
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility for algorithmic players
 * @param {number} demandPattern - Demand pattern to override in contract (3 for CUSTOM)
 * @param {number} weeks - Number of weeks to run (limited by CSV data)
 * @returns {Object} Game results and data
 */
async function runGameWithHybridPolicy(gameContract, signers, orderFlowData, hasBlockchainVisibility = false, demandPattern = 3, weeks = 20) {
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
            const retailerOrder = await placeFixedRetailerOrder(gameContract, signers[0], retailerFixedOrder);
            
            // 2. Wholesaler places order to distributor (algorithmic)
            const wholesalerOrder = await placeAlgorithmicOrder(gameContract, signers[1], Role.WHOLESALER, hasBlockchainVisibility);
            
            // 3. Distributor places order to factory (algorithmic)
            const distributorOrder = await placeAlgorithmicOrder(gameContract, signers[2], Role.DISTRIBUTOR, hasBlockchainVisibility);
            
            // 4. Factory schedules production (algorithmic)
            const factoryOrder = await scheduleProduction(gameContract, signers[3], hasBlockchainVisibility);
            
            // Process the week
            await gameContract.connect(owner).processWeek();
            
            // Collect data for each role using the collectWeeklyData function
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
        console.error("Error in runGameWithHybridPolicy:", error);
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
    
    // Run simulation with hybrid policy
    const result = await runGameWithHybridPolicy(
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
    const dataPath = path.join(__dirname, `../visualization/data_${visibilityLabel}_hybrid_${periods}_periods_full_${label}.json`);
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
        console.log("Starting Hybrid Retailer Policy Simulations");
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
        const summaryPath = path.join(__dirname, '../visualization/hybrid_simulation_summary.csv');
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
    getOrderData,
    placeAlgorithmicOrder,
    placeFixedRetailerOrder,
    scheduleProduction,
    runGameWithHybridPolicy,
    Role
}; 