/**
 * Run Order Policy Script for Beer Distribution Game
 * 
 * This script applies the ordering policy to the blockchain game, allowing testing
 * in both modes (with and without blockchain visibility).
 */

const { ethers } = require("hardhat");
const orderPolicy = require('./orderPolicy');

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
        
        // Get lead time based on contract parameters - MOVED HERE
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
            
        // For retailer, try to get customer demand directly
        let retailerAvgDemand = 4; // Default
        let endCustomerDemand = 4; // Default
        let smoothedEndCustomerDemand = 4; // Default, will be calculated
        let demandStdDev = 0; // Default (no variability for constant demand)
        
        // Get customer demand history for variability calculation
        let customerDemandHistory = [];
        
        // MODIFIED: Calculate average demand based on orders RECEIVED, not orders placed
        let incomingOrdersHistory = [];
        let receivedAvgDemand = 4; // Default value, will be adjusted below
        let usedColdStartInference = false; // Flag to track if we used cold start inference
        
        // Always retrieve end-customer demand for all roles if blockchain visibility is enabled
        // This information will be available to all roles in the blockchain scenario
        if (hasBlockchainVisibility || role === Role.RETAILER) {
            try {
                // Try to get customer demand for current week
                const customerDemand = await gameContract.getCurrentCustomerDemand();
                retailerAvgDemand = toNumber(customerDemand);
                endCustomerDemand = retailerAvgDemand;
                
                // For variable demand pattern (RANDOM or CROCS_DATA), calculate variability from history
                if (toNumber(selectedDemandPattern) === 2 || toNumber(selectedDemandPattern) === 3) { // 2 = RANDOM, 3 = CROCS_DATA
                    // Get all customer demand data available
                    const allDemand = await gameContract.getCustomerDemand();
                    
                    // Convert to an array of numbers and slice to get history up to current week
                    customerDemandHistory = allDemand.map(d => toNumber(d)).slice(0, currentWeek + 1);
                    
                    if (customerDemandHistory.length > 1) {
                        // Calculate moving average of end-customer demand (over last 3 weeks or all if fewer)
                        smoothedEndCustomerDemand = calculateMovingAverage(customerDemandHistory, 3);
                        console.log(`Calculated SMOOTHED end-customer demand: ${smoothedEndCustomerDemand.toFixed(2)} (using last ${Math.min(3, customerDemandHistory.length)} weeks)`);
                        
                        // Calculate average
                        const avg = customerDemandHistory.reduce((sum, d) => sum + d, 0) / customerDemandHistory.length;
                        
                        // Calculate standard deviation
                        const sumSquaredDiff = customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - avg, 2), 0);
                        demandStdDev = Math.sqrt(sumSquaredDiff / customerDemandHistory.length);
                        
                        console.log(`End-customer demand history: ${customerDemandHistory.join(', ')}`);
                        console.log(`End-customer demand std dev: ${demandStdDev.toFixed(2)}`);
                    } else if (currentWeek === 0) {
                        // For week 0, use the order pipeline to set up a populated history
                        // This is our buffer for cold start
                        if (orderPipeline && orderPipeline.length > 0) {
                            // Use order pipeline values as historical data
                            const nonZeroOrders = orderPipeline.filter(o => o > 0);
                            if (nonZeroOrders.length > 0) {
                                smoothedEndCustomerDemand = nonZeroOrders.reduce((sum, o) => sum + o, 0) / nonZeroOrders.length;
                            }
                            
                            // Calculate std dev from the order pipeline
                            if (nonZeroOrders.length > 1) {
                                const avg = smoothedEndCustomerDemand;
                                const sumSquaredDiff = nonZeroOrders.reduce((sum, o) => sum + Math.pow(o - avg, 2), 0);
                                demandStdDev = Math.sqrt(sumSquaredDiff / nonZeroOrders.length);
                            } else {
                                demandStdDev = 1.0; // Default if can't calculate
                            }
                            
                            console.log(`[BUFFERED START] End-customer - Using orderPipeline values for history`);
                            console.log(`[BUFFERED START] End-customer - Avg demand: ${smoothedEndCustomerDemand}, StdDev: ${demandStdDev}`);
                        } else {
                            // If order pipeline is empty, use defaults
                            smoothedEndCustomerDemand = endCustomerDemand; // Same as raw demand at week 0
                            demandStdDev = 1.0; // Reasonable default for random pattern
                            
                            console.log(`[COLD START] End-customer - Using current week's demand: ${endCustomerDemand}`);
                            console.log(`[COLD START] End-customer - Using default stdDev of ${demandStdDev}`);
                        }
                        
                        // Update the flag
                        usedColdStartInference = true;
                    }
                } else {
                    // For constant demand, just use the current demand value
                    smoothedEndCustomerDemand = endCustomerDemand;
                }
                
                console.log(`Using customer demand: ${endCustomerDemand}`);
                console.log(`Using SMOOTHED customer demand for calculations: ${smoothedEndCustomerDemand.toFixed(2)}`);
            } catch (error) {
                console.log(`Could not get customer demand, using default value`);
                
                // Use a reasonable default value but don't populate with artificial history
                if (currentWeek === 0) {
                    // Just set the average demand value, don't create history
                    usedColdStartInference = true;
                }
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
                // This should happen regardless of blockchain visibility
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
                // For week 0, use the order pipeline to set up a populated history
                // This is our buffer for cold start
                if (orderPipeline && orderPipeline.length > 0 && orderPipeline.some(o => o > 0)) {
                    // Use order pipeline values as historical data
                    incomingOrdersHistory = [...orderPipeline];
                    
                    // Calculate average from the order pipeline
                    const nonZeroOrders = orderPipeline.filter(o => o > 0);
                    if (nonZeroOrders.length > 0) {
                        receivedAvgDemand = nonZeroOrders.reduce((sum, o) => sum + o, 0) / nonZeroOrders.length;
                        
                        // Calculate std dev if possible
                        if (nonZeroOrders.length > 1) {
                            const avg = receivedAvgDemand;
                            const sumSquaredDiff = nonZeroOrders.reduce((sum, o) => sum + Math.pow(o - avg, 2), 0);
                            demandStdDev = Math.sqrt(sumSquaredDiff / nonZeroOrders.length);
                        } else {
                            // Use default stdDev calculation if can't calculate directly
                            demandStdDev = Math.max(1.0, receivedAvgDemand * 0.25);
                        }
                    }
                    
                    console.log(`[BUFFERED START] Role ${role} - Using orderPipeline values for history: ${incomingOrdersHistory.join(', ')}`);
                    console.log(`[BUFFERED START] Role ${role} - Using avgDemand: ${receivedAvgDemand}, stdDev: ${demandStdDev}`);
                } else {
                    // If order pipeline is empty, use defaults
                    receivedAvgDemand = 4; // Default for week 0
                    demandStdDev = 1.0; // Reasonable default
                    console.log(`[COLD START] Role ${role} - Using default avgDemand: ${receivedAvgDemand}, stdDev: ${demandStdDev}`);
                }
                
                // Update the flag
                usedColdStartInference = true;
            }
            
            // Log the data
            const logPrefix = hasBlockchainVisibility ? '[BLOCKCHAIN]' : '[TRADITIONAL]';
            console.log(`${logPrefix} Role ${role} - Using avgDemand from RECEIVED orders: ${receivedAvgDemand}`);
            console.log(`${logPrefix} Role ${role} - Incoming orders history: [${incomingOrdersHistory.join(', ')}]`);
            console.log(`${logPrefix} Role ${role} - Using stdDev: ${demandStdDev.toFixed(2)}`);
        }
        
        // Basic order data that's always available
        orderData = {
            role,
            onHand,
            backlog,
            onOrder,
            currentWeek,
            weekNum: currentWeek,
            previousOrders, // Keep for backward compatibility
            incomingOrdersHistory, // Add the new incoming orders history
            leadTime,
            serviceLevel: 0.97, // Increased from 0.85 for higher safety stock
            demandVariability: 1.0, // Default variability
            selectedDemandPattern: toNumber(selectedDemandPattern),
            usedColdStartInference: usedColdStartInference || false
        };
        
        // FIXED: Set avgDemand based on visibility mode, not just role
        // In blockchain mode, all players use end customer demand
        // In traditional mode, each player uses their local received order data
        if (hasBlockchainVisibility) {
            orderData.avgDemand = smoothedEndCustomerDemand;
            orderData.demandStdDev = demandStdDev;
            console.log(`[BLOCKCHAIN] Role ${role} - Using END CUSTOMER smoothed demand for calculations: ${smoothedEndCustomerDemand.toFixed(2)}`);
        } else {
            orderData.avgDemand = role === Role.RETAILER ? smoothedEndCustomerDemand : receivedAvgDemand;
            orderData.demandStdDev = demandStdDev; // Standard deviation
            if (role === Role.RETAILER) {
                console.log(`[TRADITIONAL] Retailer using SMOOTHED demand for base stock calculation: ${smoothedEndCustomerDemand.toFixed(2)} (vs current week: ${endCustomerDemand})`);
            }
        }
        
        // Add end-customer demand data when blockchain visibility is enabled
        if (hasBlockchainVisibility) {
            orderData.endCustomerDemand = endCustomerDemand;
            orderData.smoothedEndCustomerDemand = smoothedEndCustomerDemand; // Add smoothed demand
            orderData.customerDemandHistory = customerDemandHistory;
        }
        
        // Add blockchain visibility data when enabled
        if (hasBlockchainVisibility) {
            orderData.hasBlockchainVisibility = true;
            // For each role except retailer, get data from their customer (one level down)
            if (role > 0) {
                // Get downstream customer data
                const downstreamRole = role - 1;
                const downstreamData = await gameContract.getMemberData(downstreamRole);
                
                // Get downstream previous orders to calculate their average demand
                let downstreamPreviousOrders = [];
                for (let i = Math.max(0, currentWeek - 10); i < currentWeek; i++) {
                    try {
                        const order = await gameContract.getMemberOrderForWeek(downstreamRole, i);
                        downstreamPreviousOrders.push(toNumber(order));
                    } catch (error) {
                        downstreamPreviousOrders.push(0);
                    }
                }
                
                // Calculate downstream average demand
                const downstreamAvgDemand = downstreamPreviousOrders.length > 0 
                    ? downstreamPreviousOrders.reduce((sum, order) => sum + order, 0) / downstreamPreviousOrders.length 
                    : 4; // Default to 4
                
                // Calculate downstream on-order correctly from shipment pipeline
                let downstreamOnOrder = 0;
                try {
                    const downstreamShipmentPipeline = await gameContract.getShipmentPipeline(downstreamRole);
                    downstreamOnOrder = downstreamShipmentPipeline.reduce((sum, shipment) => sum + toNumber(shipment), 0);
                } catch (error) {
                    console.error(`Error getting shipment pipeline for downstream role ${downstreamRole}:`, error);
                    downstreamOnOrder = 0;
                }
                
                // Calculate downstream demand standard deviation
                let downstreamDemandStdDev = 0;
                if (downstreamPreviousOrders.length > 1 && downstreamPreviousOrders.some(o => o > 0)) {
                    const nonZeroOrders = downstreamPreviousOrders.filter(o => o > 0);
                    const avg = nonZeroOrders.reduce((sum, o) => sum + o, 0) / nonZeroOrders.length;
                    const sumSquaredDiff = nonZeroOrders.reduce((sum, o) => sum + Math.pow(o - avg, 2), 0);
                    downstreamDemandStdDev = Math.sqrt(sumSquaredDiff / nonZeroOrders.length);
                } else {
                    // Use default if can't calculate
                    downstreamDemandStdDev = Math.max(1.0, downstreamAvgDemand * 0.25);
                }
                
                orderData.downstreamData = {
                    role: downstreamRole,
                    onHand: toNumber(downstreamData[0]),
                    backlog: toNumber(downstreamData[1]),
                    onOrder: downstreamOnOrder,
                    avgDemand: downstreamAvgDemand,
                    demandStdDev: downstreamDemandStdDev
                };
                
                // Calculate downstream inventory position
                orderData.downstreamIP = orderData.downstreamData.onHand + 
                                         orderData.downstreamData.onOrder - 
                                         orderData.downstreamData.backlog;
                
                // Calculate downstream target using their demand and lead time
                // Base stock level is calculated the same way for downstream
                let downstreamTarget;
                
                if (orderData.hasBlockchainVisibility) {
                    // With blockchain visibility, we should use downstream's actual target stock
                    // First, determine if demand is constant
                    const isConstantDemand = orderData.selectedDemandPattern === 0;
                    
                    // *** FIX: Use end-customer demand for downstream's target with blockchain visibility ***
                    // We'll calculate a proper base stock target for downstream based on global data
                    // Instead of using their local order history (which amplifies the bullwhip effect)
                    const downstreamAvgDemand = smoothedEndCustomerDemand; // FIX: Use global end-customer demand
                    
                    // Get appropriate safety factor for service level
                    const serviceLevel = orderData.serviceLevel || 0.85;
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
                    downstreamTarget = downstreamAvgDemand * leadTime;
                    
                    // Add safety stock for non-constant demand
                    if (!isConstantDemand) {
                        // *** FIX: Use end-customer demand std dev for downstream's target ***
                        // Use calculated standard deviation from end-customer demand, not local orders
                        const downstreamStdDev = demandStdDev; // FIX: Use global std dev
                        
                        // Add safety stock: safety factor * standard deviation of demand during lead time
                        const safetyStock = safetyFactor * downstreamStdDev * Math.sqrt(leadTime);
                        downstreamTarget += safetyStock;
                        
                        console.log(`Adding downstream safety stock of ${safetyStock.toFixed(2)} units (demandStdDev: ${downstreamStdDev.toFixed(2)}, leadTime: ${leadTime})`);
                    }
                } else {
                    // Without blockchain, use their local demand without safety stock
                    downstreamTarget = downstreamAvgDemand * leadTime;
                }
                
                console.log(`DEBUG - About to set downstreamS. Calculated downstreamTarget=${downstreamTarget}`);
                orderData.downstreamS = downstreamTarget;
                console.log(`DEBUG - After assignment: orderData.downstreamS=${orderData.downstreamS}`);
                
                // Update the log message to show which demand values are being used
                if (orderData.hasBlockchainVisibility) {
                    console.log(`Downstream data - Role: ${downstreamRole}, IP: ${orderData.downstreamIP}, S: ${orderData.downstreamS}, Avg Demand: ${downstreamAvgDemand}, StdDev: ${orderData.downstreamData.demandStdDev.toFixed(2)}, On-Order: ${downstreamOnOrder}`);
                    console.log(`Using GLOBAL end-customer demand for downstream target calculation: Avg=${smoothedEndCustomerDemand.toFixed(2)}, StdDev=${demandStdDev.toFixed(2)}`);
                } else {
                    console.log(`Downstream data - Role: ${downstreamRole}, IP: ${orderData.downstreamIP}, S: ${orderData.downstreamS}, Avg Demand: ${downstreamAvgDemand}, StdDev: ${orderData.downstreamData.demandStdDev.toFixed(2)}, On-Order: ${downstreamOnOrder}`);
                }
            }
            
            // Get pipeline data if blockchain visibility is enabled
            try {
                if (role < 3) { // Not Factory
                    // Get supplier pipeline - what's on its way to this role
                    const supplierRole = role + 1;
                    const pipeline = await gameContract.getShipmentPipeline(role);
                    
                    orderData.supplierPipeline = {
                        pipeline: pipeline.map(p => toNumber(p))
                    };
                    console.log(`Shipment pipeline for role ${role}: [${orderData.supplierPipeline.pipeline.join(', ')}]`);
                }
                
                // Get order pipeline if available
                if (role < 3) { // Not Factory
                    const orderPipeline = await gameContract.getOrderPipeline(role);
                    orderData.orderPipeline = {
                        pipeline: orderPipeline.map(p => toNumber(p))
                    };
                    console.log(`Order pipeline for role ${role}: [${orderData.orderPipeline.pipeline.join(', ')}]`);
                }
            } catch (error) {
                console.error(`Error getting pipeline data:`, error);
            }
        } else {
            // Additional debugging output for traditional mode
            console.log(`[TRADITIONAL] Role ${role} - Using avgDemand from RECEIVED orders: ${orderData.avgDemand}, stdDev: ${demandStdDev.toFixed(2)}`);
            console.log(`[TRADITIONAL] Role ${role} - Incoming orders history: [${incomingOrdersHistory.join(', ')}]`);
            console.log(`[TRADITIONAL] Role ${role} - Own outgoing orders history: [${previousOrders.join(', ')}]`);
        }
        
        // Log inventory positions for clarity
        console.log(`[Week ${currentWeek}] PRE-DECISION State for Role ${role} (${roleToString(role)}):`);
        console.log(`           On Hand: ${onHand}`);
        console.log(`           On Order: ${onOrder}`);
        console.log(`           Backlog: ${backlog}`);
        console.log(`           Inventory Position: ${onHand + onOrder - backlog}`);
        if (hasBlockchainVisibility && orderData.downstreamIP !== undefined) {
            console.log(`           Downstream IP: ${orderData.downstreamIP}`);
        }
        
        // Final calculated IP for clarity
        console.log(`Final inventory position for role ${role}: IP = OH(${onHand}) + OO(${onOrder}) - BO(${backlog}) = ${onHand + onOrder - backlog}`);
        
        return orderData;
    } catch (error) {
        console.error(`Error in getOrderData for role ${role}:`, error);
        throw error;
    }
}

/**
 * Place an order for a specific role based on the policy
 * 
 * @param {Contract} gameContract - The BeerDistributionGame contract
 * @param {object} signer - The signer for the given role
 * @param {number} role - The role number (0-3)
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @param {Object} tuningParams - Optional tuning parameters for the blockchain mode
 * @returns {Promise<Object>} - Order amount and debug info
 */
async function placeOrder(gameContract, signer, role, hasBlockchainVisibility, tuningParams = null) {
    try {
        // Get order data
        const orderData = await getOrderData(gameContract, role, hasBlockchainVisibility);
        
        // If tuning parameters are provided, add them to the order data
        if (hasBlockchainVisibility && tuningParams) {
            orderData.tuningParams = tuningParams;
        }
        
        // Calculate the order using the order policy
        const orderAmount = orderPolicy.calculateOrder(orderData);
        
        // Place the order
        const tx = await gameContract.connect(signer).placeOrder(orderAmount);
        await tx.wait();
        
        // Log for debugging
        console.log(`Role ${role} (${roleToString(role)}) placing order of ${orderAmount} units`);
        if (hasBlockchainVisibility && tuningParams) {
            console.log(`Using tuning parameters: TH=${tuningParams.thresholdHigh}, MA=${tuningParams.minAlpha}`);
        }
        
        // Create debug info for analysis
        const debugInfo = {
            avgDemand: orderData.avgDemand,
            demandStdDev: orderData.demandStdDev || 0,
            localStdDev: orderData.localDemandStdDev || 0,
            leadTime: orderData.leadTime,
            previousOrders: orderData.previousOrders.join(','),
            incomingOrders: orderData.incomingOrdersHistory.join(','),
            usedColdStart: orderData.usedColdStartInference || false,
            tuningParams: hasBlockchainVisibility && tuningParams ? tuningParams : null
        };
        
        return { amount: orderAmount, debugInfo: debugInfo };
    } catch (error) {
        console.error(`Error in placeOrder for role ${role}:`, error);
        throw error;
    }
}

/**
 * Schedule production for the factory based on the policy
 * 
 * @param {Contract} gameContract - The BeerDistributionGame contract
 * @param {object} signer - The signer for the factory
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @param {Object} tuningParams - Optional tuning parameters for the blockchain mode
 * @returns {Promise<Object>} - Production amount and debug info
 */
async function scheduleProduction(gameContract, signer, hasBlockchainVisibility, tuningParams = null) {
    try {
        // Get order data for factory (role 3)
        const factoryData = await getOrderData(gameContract, Role.FACTORY, hasBlockchainVisibility);
        
        // If tuning parameters are provided, add them to the order data
        if (hasBlockchainVisibility && tuningParams) {
            factoryData.tuningParams = tuningParams;
        }
        
        // Calculate the production amount using the order policy
        const productionAmount = orderPolicy.calculateProduction(factoryData);
        
        // Schedule the production
        const tx = await gameContract.connect(signer).scheduleProduction(productionAmount);
        await tx.wait();
        
        // Log for debugging
        console.log(`Factory scheduling production of ${productionAmount} units`);
        if (hasBlockchainVisibility && tuningParams) {
            console.log(`Using tuning parameters: TH=${tuningParams.thresholdHigh}, MA=${tuningParams.minAlpha}`);
        }
        
        // Create debug info for analysis
        const debugInfo = {
            avgDemand: factoryData.avgDemand,
            demandStdDev: factoryData.demandStdDev || 0,
            localStdDev: factoryData.localDemandStdDev || 0,
            leadTime: factoryData.leadTime,
            previousOrders: factoryData.previousOrders.join(','),
            incomingOrders: factoryData.incomingOrdersHistory.join(','),
            tuningParams: hasBlockchainVisibility && tuningParams ? tuningParams : null
        };
        
        return { amount: productionAmount, debugInfo: debugInfo };
    } catch (error) {
        console.error(`Error in scheduleProduction:`, error);
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

// Helper to get phase name from number
function phaseToString(phase) {
    const phases = ["WEEK_START", "AFTER_SHIPMENTS", "AFTER_ORDERS", "WEEK_END"];
    return phases[phase] || "UNKNOWN";
}

// Get state snapshot data
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

// Modified weekly data collection to use state snapshots
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
        
        // Verify the onOrder calculation by logging out the shipment pipeline
        let onOrderVerification = 0;
        try {
            const shipmentPipeline = await gameContract.getShipmentPipeline(role);
            onOrderVerification = shipmentPipeline.reduce((sum, shipment) => sum + toNumber(shipment), 0);
            
            // If we have both snapshots and onOrder doesn't match, log the issue
            if (weekStartSnapshot && Math.abs(onOrderVerification - weekStartSnapshot.onOrder) > 0.001) {
                console.log(`WARNING: Role ${role} Week ${week} - onOrder mismatch! JSON data: ${weekStartSnapshot.onOrder}, Actual shipment pipeline sum: ${onOrderVerification}`);
            }
        } catch (error) {
            console.error(`Error verifying onOrder for role ${role}:`, error);
        }
        
        // Calculate the total cost up to this week
        const totalCost = prevTotalCost + (weekEndSnapshot ? weekEndSnapshot.weeklyCost : 0);
        
        // Use debug info from the order data
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
            weeklyCost: weekEndSnapshot ? weekEndSnapshot.weeklyCost : 0,
            totalCost: totalCost,
            
            // Debug information from order calculation
            debugInfo: orderData?.debugInfo || {}
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
            weeklyCost: 0,
            totalCost: prevTotalCost,
            debugInfo: orderData?.debugInfo || {}
        };
    }
}

/**
 * Run the game simulation with the policy
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer[]} signers - Array of signers for each role
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @param {number} demandPattern - Demand pattern to use (0=CONSTANT, 1=STEP, 2=RANDOM)
 * @param {number} weeks - Number of weeks to run
 * @returns {Object} Game results and data
 */
async function runGameWithPolicy(gameContract, signers, hasBlockchainVisibility, demandPattern = 0, weeks = 20) {
    try {
        // Initialize game with owner
        const owner = await ethers.provider.getSigner(0);
        await gameContract.connect(owner).initializeGame(demandPattern);
        
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
            console.log(`\nProcessing Week ${week}`);
            
            // Get customer demand for this week (for logging)
            let customerDemand;
            try {
                customerDemand = await gameContract.getCurrentCustomerDemand();
                customerDemand = toNumber(customerDemand);
                weeklyData.customer[week] = { demand: customerDemand };
            } catch (error) {
                console.log("Could not get customer demand for this week.");
                customerDemand = "Unknown";
            }
            
            // 1. Retailer places order to wholesaler
            const retailerOrder = await placeOrder(gameContract, signers[0], Role.RETAILER, hasBlockchainVisibility);
            
            // 2. Wholesaler places order to distributor
            const wholesalerOrder = await placeOrder(gameContract, signers[1], Role.WHOLESALER, hasBlockchainVisibility);
            
            // 3. Distributor places order to factory
            const distributorOrder = await placeOrder(gameContract, signers[2], Role.DISTRIBUTOR, hasBlockchainVisibility);
            
            // 4. Factory schedules production
            const factoryOrder = await scheduleProduction(gameContract, signers[3], hasBlockchainVisibility);
            
            // Process the week
            await gameContract.connect(owner).processWeek();
            
            // Collect data for each role using the new collectWeeklyData function
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
        }
        
        // Calculate final cost
        const finalCost = await gameContract.getTotalSupplyChainCost();
        
        return {
            weeklyData,
            finalCost
        };
    } catch (error) {
        console.error("Error in runGameWithPolicy:", error);
        throw error;
    }
}

/**
 * Run the game simulation with tunable policy parameters
 * 
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer[]} signers - Array of signers for each role
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @param {number} demandPattern - Demand pattern to use (0=CONSTANT, 1=STEP, 2=RANDOM, 3=CUSTOM)
 * @param {number} weeks - Number of weeks to run
 * @param {Object} tuningParams - Tuning parameters for the blockchain adjustment algorithm
 * @returns {Object} Game results and data
 */
async function runGameWithPolicyAndParams(gameContract, signers, hasBlockchainVisibility, demandPattern = 0, weeks = 20, tuningParams = { thresholdHigh: 0.9, minAlpha: 0.8 }) {
    try {
        console.log(`Running simulation with ${hasBlockchainVisibility ? 'blockchain' : 'traditional'} visibility`);
        if (hasBlockchainVisibility && tuningParams) {
            console.log(`Using tuning parameters: ThresholdHigh=${tuningParams.thresholdHigh}, MinAlpha=${tuningParams.minAlpha}`);
        }
        
        // Initialize game with owner
        const owner = await ethers.provider.getSigner(0);
        await gameContract.connect(owner).initializeGame(demandPattern);
        
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
            console.log(`\nProcessing Week ${week}`);
            if (hasBlockchainVisibility && tuningParams) {
                console.log(`Using tuning parameters: TH=${tuningParams.thresholdHigh}, MA=${tuningParams.minAlpha}`);
            }
            
            // Get customer demand for this week (for logging)
            let customerDemand;
            try {
                customerDemand = await gameContract.getCurrentCustomerDemand();
                customerDemand = toNumber(customerDemand);
                weeklyData.customer[week] = { demand: customerDemand };
            } catch (error) {
                console.log("Could not get customer demand for this week.");
                customerDemand = "Unknown";
            }
            
            // 1. Retailer places order to wholesaler
            let retailerOrder;
            if (hasBlockchainVisibility && tuningParams) {
                retailerOrder = await placeOrder(gameContract, signers[0], Role.RETAILER, hasBlockchainVisibility, tuningParams);
            } else {
                retailerOrder = await placeOrder(gameContract, signers[0], Role.RETAILER, hasBlockchainVisibility);
            }
            
            // 2. Wholesaler places order to distributor
            let wholesalerOrder;
            if (hasBlockchainVisibility && tuningParams) {
                wholesalerOrder = await placeOrder(gameContract, signers[1], Role.WHOLESALER, hasBlockchainVisibility, tuningParams);
            } else {
                wholesalerOrder = await placeOrder(gameContract, signers[1], Role.WHOLESALER, hasBlockchainVisibility);
            }
            
            // 3. Distributor places order to factory
            let distributorOrder;
            if (hasBlockchainVisibility && tuningParams) {
                distributorOrder = await placeOrder(gameContract, signers[2], Role.DISTRIBUTOR, hasBlockchainVisibility, tuningParams);
            } else {
                distributorOrder = await placeOrder(gameContract, signers[2], Role.DISTRIBUTOR, hasBlockchainVisibility);
            }
            
            // 4. Factory schedules production
            let factoryOrder;
            if (hasBlockchainVisibility && tuningParams) {
                factoryOrder = await scheduleProduction(gameContract, signers[3], hasBlockchainVisibility, tuningParams);
            } else {
                factoryOrder = await scheduleProduction(gameContract, signers[3], hasBlockchainVisibility);
            }
            
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
        }
        
        // Calculate final cost
        const finalCost = await gameContract.getTotalSupplyChainCost();
        
        // Return results including tuning parameters
        return {
            weeklyData,
            finalCost,
            tuningParams: hasBlockchainVisibility ? tuningParams : null
        };
    } catch (error) {
        console.error("Error in runGameWithPolicyAndParams:", error);
        throw error;
    }
}

// Export functions for use in other scripts
module.exports = {
    getOrderData,
    placeOrder,
    scheduleProduction,
    runGameWithPolicy,
    runGameWithPolicyAndParams,
    Role
}; 