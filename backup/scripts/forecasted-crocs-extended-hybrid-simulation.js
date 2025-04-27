/**
 * Forecasted Crocs Supply Chain Simulation Script with Extended Hybrid Policy
 * 
 * This script runs the beer distribution game simulation using forecasted order flow data
 * from the Crocs supply chain, specifically using:
 * - Customer demand from "Customer → FL Orders ($)" column
 * - Retailer orders from "FL → Crocs Orders ($)" column 
 * - Wholesaler orders from "Crocs → YY Orders ($)" column
 * 
 * It implements an extended hybrid policy where:
 * - Customer demand comes from the CSV file
 * - Retailer orders come from the CSV file
 * - Wholesaler orders come from the CSV file
 * - Distributor and Factory use the algorithmic policy
 * 
 * It compares the performance with and without blockchain visibility for the algorithmic players.
 * 
 * Results are saved to the visualization directory for analysis and visualization.
 */

const { ethers } = require("hardhat");
const orderPolicy = require('./policies/orderPolicy');
const fs = require('fs'); // Import file system module
const path = require('path'); // Import path module
const csv = require('csv-parser'); // Add this dependency for CSV parsing

// Enum values for roles from BeerDistributionGame contract
const Role = {
    RETAILER: 0,
    WHOLESALER: 1,
    DISTRIBUTOR: 2,
    FACTORY: 3
};

// Enum values for demand patterns from BeerDistributionGame contract
const DemandPattern = {
    CONSTANT: 0,
    STEP_INCREASE: 1,
    RANDOM: 2,
    CUSTOM: 3
};

/**
 * Convert a BigInt to a number for calculation
 * @param {BigInt|number} value - The value to convert
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
                // Extract customer demand, retailer order, and wholesaler order from the CSV columns
                const customerDemand = parseFloat(data['Customer → FL Orders ($)']);
                const retailerOrder = parseFloat(data['FL → Crocs Orders ($)']);
                const wholesalerOrder = parseFloat(data['Crocs → YY Orders ($)']);
                
                // Only push if we have valid numbers
                if (!isNaN(customerDemand) && !isNaN(retailerOrder) && !isNaN(wholesalerOrder)) {
                    results.push({
                        customerDemand,
                        retailerOrder,
                        wholesalerOrder
                    });
                }
            })
            .on('end', () => {
                if (results.length === 0) {
                    reject(new Error('No valid order data found in CSV'));
                } else {
                    console.log(`Read ${results.length} order data points from CSV`);
                    console.log(`Customer demand values (first 5): ${results.slice(0, 5).map(d => d.customerDemand).join(', ')}...`);
                    console.log(`Retailer order values (first 5): ${results.slice(0, 5).map(d => d.retailerOrder).join(', ')}...`);
                    console.log(`Wholesaler order values (first 5): ${results.slice(0, 5).map(d => d.wholesalerOrder).join(', ')}...`);
                    resolve(results);
                }
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

/**
 * Utility function to convert role number to string
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
 * Save data to JSON file
 * @param {string} filePath - Path to save JSON data
 * @param {Object} data - Data to save
 */
function saveDataToJson(filePath, data) {
    try {
        // Ensure directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`Data saved to: ${filePath}`);
    } catch (error) {
        console.error(`Error saving data to ${filePath}:`, error);
    }
}

/**
 * Place a fixed order for a role based on CSV data
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - Signer for the role
 * @param {number} role - Role number 
 * @param {number} orderQuantity - Order quantity from CSV
 * @returns {number} - The placed order quantity
 */
async function placeFixedOrder(gameContract, signer, role, orderQuantity) {
    try {
        console.log(`Role ${role} (${roleToString(role)}) placing order of ${orderQuantity} units`);
        await gameContract.connect(signer).placeOrder(orderQuantity);
        return orderQuantity;
    } catch (error) {
        console.error(`Error in placing fixed order for role ${role}:`, error);
        return 0;
    }
}

/**
 * Get necessary game data for algorithmic order calculation
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
            orderPipeline = await gameContract.getOrderPipeline(role);
            orderPipeline = orderPipeline.map(order => toNumber(order));
            console.log(`Order pipeline for role ${role}: [${orderPipeline.join(', ')}]`);
        } catch (error) {
            console.error(`Error getting order pipeline for role ${role}:`, error);
        }
        
        // Collect information about incoming orders
        let incomingOrdersHistory = [];
        let receivedAvgDemand = 0; // Default value, will be adjusted below
        
        // Calculate smoothed end-customer demand for blockchain scenario
        let customerDemandHistory = [];
        let endCustomerDemand = 0;
        let smoothedEndCustomerDemand = 0;
        
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
                
                // Calculate smoothed demand using last 3 weeks if available
                const weeksToAverage = Math.min(3, customerDemandHistory.length);
                if (weeksToAverage > 0) {
                    const recentDemand = customerDemandHistory.slice(-weeksToAverage);
                    const sum = recentDemand.reduce((a, b) => a + b, 0);
                    smoothedEndCustomerDemand = sum / weeksToAverage;
                    
                    console.log(`Calculated SMOOTHED end-customer demand: ${smoothedEndCustomerDemand.toFixed(2)} (using last ${weeksToAverage} weeks)`);
                    console.log(`End-customer demand history: ${customerDemandHistory.join(', ')}`);
                    
                    // Calculate standard deviation
                    const avg = smoothedEndCustomerDemand;
                    const squaredDiffs = customerDemandHistory.map(d => Math.pow(d - avg, 2));
                    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / customerDemandHistory.length;
                    const stdDev = Math.sqrt(avgSquaredDiff);
                    console.log(`End-customer demand std dev: ${stdDev.toFixed(2)}`);
                }
            } catch (error) {
                console.error(`Error getting customer demand for role ${role}:`, error);
            }
        }
        
        // Get incoming orders based on role
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
            
            // Calculate the average demand received from downstream
            if (incomingOrdersHistory.length > 0) {
                // Use only the last 7 weeks of orders for average calculation, or fewer if not available
                const avgCount = Math.min(7, incomingOrdersHistory.length);
                const recentOrders = incomingOrdersHistory.slice(-avgCount);
                const sum = recentOrders.reduce((a, b) => a + b, 0);
                receivedAvgDemand = sum / avgCount;
            }
            
            // Calculate the standard deviation of orders for inventory safety stock
            let receivedOrderStdDev = 0;
            if (incomingOrdersHistory.length > 1) {
                const squaredDiffs = incomingOrdersHistory.map(o => Math.pow(o - receivedAvgDemand, 2));
                const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / incomingOrdersHistory.length;
                receivedOrderStdDev = Math.sqrt(avgSquaredDiff);
            }
            
            console.log(`Role ${role} - Calculated LOCAL stdDev: ${receivedOrderStdDev.toFixed(2)} from received orders`);
        }
        
        // For blockchain scenario, we provide additional downstream inventory data
        let downstreamInventoryPosition = null;
        let downstreamTargetS = null;
        let downstreamOnOrder = null;
        
        if (hasBlockchainVisibility && role > Role.RETAILER) {
            try {
                const downstreamRole = role - 1;
                
                // Get downstream player's inventory information
                const downstreamMemberData = await gameContract.getMemberData(downstreamRole);
                const downstreamOnHand = toNumber(downstreamMemberData[0]);
                const downstreamBacklog = toNumber(downstreamMemberData[1]);
                
                // Get downstream shipment pipeline
                let downstreamShipmentPipeline = [];
                try {
                    downstreamShipmentPipeline = await gameContract.getShipmentPipeline(downstreamRole);
                    downstreamOnOrder = downstreamShipmentPipeline.reduce((sum, val) => sum + toNumber(val), 0);
                } catch (error) {
                    console.error(`Error getting downstream shipment pipeline for role ${downstreamRole}:`, error);
                    downstreamOnOrder = 0;
                }
                
                // Calculate downstream player's inventory position
                downstreamInventoryPosition = downstreamOnHand + downstreamOnOrder - downstreamBacklog;
                
                // Use end customer demand with safety stock formula to determine optimal target level
                // S = μL + zσ√L where μ is demand, L is lead time, z is safety factor, and σ is demand std dev
                const safetyFactor = 1.96; // 97% service level (z-score)
                const endCustomerStdDev = Math.sqrt(
                    customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - smoothedEndCustomerDemand, 2), 0) / 
                    customerDemandHistory.length
                );
                
                // Calculate target S for downstream player with safety stock
                const downstreamLeadTime = 2; // Downstream lead time is fixed at 2 for our model
                
                // Calculate safety stock component: z * σ * sqrt(L)
                const safetyStock = safetyFactor * endCustomerStdDev * Math.sqrt(downstreamLeadTime);
                
                // Target S = μL + safety stock = average demand * lead time + safety stock
                downstreamTargetS = smoothedEndCustomerDemand * downstreamLeadTime + safetyStock;
                
                console.log(`Adding downstream safety stock of ${safetyStock.toFixed(2)} units (demandStdDev: ${endCustomerStdDev.toFixed(2)}, leadTime: ${downstreamLeadTime})`);
                console.log(`DEBUG - About to set downstreamS. Calculated downstreamTarget=${downstreamTargetS}`);
                console.log(`DEBUG - After assignment: orderData.downstreamS=${downstreamTargetS}`);
                
                console.log(`Downstream data - Role: ${downstreamRole}, IP: ${downstreamInventoryPosition}, S: ${downstreamTargetS}, Avg Demand: ${receivedAvgDemand.toFixed(1)}, StdDev: ${endCustomerStdDev.toFixed(2)}, On-Order: ${downstreamOnOrder}`);
            } catch (error) {
                console.error(`Error getting downstream data for role ${role}:`, error);
            }
        }
        
        // Gather and return all the order data
        let demandToUse;
        let stdDevToUse;
        
        if (hasBlockchainVisibility) {
            // In blockchain case, all roles use the end customer demand for calculations
            console.log(`[BLOCKCHAIN] Role ${role} - Using avgDemand from RECEIVED orders: ${receivedAvgDemand}`);
            console.log(`[BLOCKCHAIN] Role ${role} - Incoming orders history: [${incomingOrdersHistory.join(', ')}]`);
            
            // In blockchain case, use end customer demand std dev
            const endCustomerStdDev = Math.sqrt(
                customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - smoothedEndCustomerDemand, 2), 0) / 
                customerDemandHistory.length
            );
            
            console.log(`[BLOCKCHAIN] Role ${role} - Using stdDev: ${endCustomerStdDev.toFixed(2)}`);
            console.log(`[BLOCKCHAIN] Role ${role} - Using END CUSTOMER smoothed demand for calculations: ${smoothedEndCustomerDemand}`);
            
            demandToUse = smoothedEndCustomerDemand;
            stdDevToUse = endCustomerStdDev;
        } else {
            // In traditional case, use local demand estimates
            if (role === Role.RETAILER) {
                demandToUse = smoothedEndCustomerDemand;
                
                // Calculate standard deviation for retailer (uses customer demand)
                stdDevToUse = Math.sqrt(
                    customerDemandHistory.reduce((sum, d) => sum + Math.pow(d - smoothedEndCustomerDemand, 2), 0) / 
                    customerDemandHistory.length
                );
                
                console.log(`Using SMOOTHED customer demand for calculations: ${demandToUse}`);
            } else {
                demandToUse = receivedAvgDemand;
                
                // Calculate standard deviation of received orders
                const squaredDiffs = incomingOrdersHistory.map(o => Math.pow(o - receivedAvgDemand, 2));
                stdDevToUse = Math.sqrt(
                    squaredDiffs.reduce((a, b) => a + b, 0) / Math.max(1, incomingOrdersHistory.length)
                );
                
                console.log(`Role ${role} - Calculated LOCAL stdDev: ${stdDevToUse.toFixed(2)} from received orders`);
            }
        }
        
        // Calculate inventory position
        const inventoryPosition = onHand + onOrder - backlog;
        
        // Use most recent customer demand
        const currentCustomerDemand = customerDemandHistory[customerDemandHistory.length - 1] || 0;
        
        return {
            role,
            currentWeek,
            onHand,
            onOrder,
            backlog,
            inventoryPosition,
            leadTime,
            customerDemand: endCustomerDemand,
            currentCustomerDemand,
            smoothedEndCustomerDemand,
            avgDemand: demandToUse,
            stdDev: stdDevToUse,
            incomingOrdersHistory,
            hasBlockchainVisibility,
            downstreamInventoryPosition,
            downstreamTargetS,
            downstreamOnOrder
        };
    } catch (error) {
        console.error("Error in getOrderData:", error);
        return {
            role,
            hasBlockchainVisibility,
            error: error.message
        };
    }
}

/**
 * Place an algorithmic order based on inventory position and demand estimates
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - Signer for the role
 * @param {number} role - Role number
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @returns {number} - The placed order quantity
 */
async function placeAlgorithmicOrder(gameContract, signer, role, hasBlockchainVisibility) {
    try {
        const orderData = await getOrderData(gameContract, role, hasBlockchainVisibility);
        
        if (orderData.error) {
            console.error(`Error getting order data for role ${role}:`, orderData.error);
            return 0;
        }
        
        const orderQuantity = orderPolicy.calculateOrder(orderData);
        console.log(`Role ${role} (${roleToString(role)}) placing order of ${orderQuantity} units`);
        
        await gameContract.connect(signer).placeOrder(orderQuantity);
        return orderQuantity;
    } catch (error) {
        console.error(`Error placing order for role ${role}:`, error);
        return 0;
    }
}

/**
 * Schedule production for the factory role (similar to placing an order)
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - Signer for the factory role
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @returns {number} - The scheduled production quantity
 */
async function scheduleProduction(gameContract, signer, hasBlockchainVisibility) {
    try {
        // Make sure we're using the signer for Role.FACTORY (which is 3)
        const orderData = await getOrderData(gameContract, Role.FACTORY, hasBlockchainVisibility);
        
        if (orderData.error) {
            console.error(`Error getting order data for factory:`, orderData.error);
            return 0;
        }
        
        const orderQuantity = orderPolicy.calculateOrder(orderData);
        console.log(`Factory scheduling production of ${orderQuantity} units`);
        
        try {
            // Make sure the signer is authorized as factory
            await gameContract.connect(signer).scheduleProduction(orderQuantity);
            return orderQuantity;
        } catch (error) {
            console.error(`Error scheduling production:`, error);
            return 0;
        }
    } catch (error) {
        console.error(`Error in scheduleProduction:`, error);
        return 0;
    }
}

/**
 * Collect weekly data for visualization and analysis
 * @param {Contract} gameContract - The deployed contract
 * @param {number} week - Current week
 * @param {string} roleName - Name of the role
 * @param {number} role - Role number
 * @param {number} orderPlaced - Order quantity placed this week
 * @param {number} prevTotalCost - Previous total cost
 * @returns {Object} - Weekly data for this role
 */
async function collectWeeklyData(gameContract, week, roleName, role, orderPlaced, prevTotalCost) {
    try {
        // Get the member's data
        const memberData = await gameContract.getMemberData(role);
        const inventory = toNumber(memberData[0]);
        const backlog = toNumber(memberData[1]);
        
        // Calculate the cost for this week
        const totalCost = toNumber(memberData[6]); // Total cost from member data
        const weeklyCost = totalCost - (prevTotalCost || 0);
        
        // Collect the data into an object
        return {
            week,
            role: roleName,
            inventory,
            backlog,
            orderPlaced,
            weeklyCost,
            totalCost
        };
    } catch (error) {
        console.error(`Error collecting weekly data for ${roleName}:`, error);
        return {
            week,
            role: roleName,
            error: error.message
        };
    }
}

/**
 * Run the game simulation with extended hybrid policy
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer[]} signers - Array of signers for each role
 * @param {Array} orderFlowData - Order flow data from CSV containing customer demand, retailer orders, and wholesaler orders
 * @param {boolean} hasBlockchainVisibility - Whether to use blockchain visibility
 * @param {number} weeks - Number of weeks to run the simulation
 * @returns {Object} - Simulation results with weekly data for each role
 */
async function runGameWithExtendedHybridPolicy(gameContract, signers, orderFlowData, hasBlockchainVisibility, weeks) {
    try {
        // Ensure the gameContract is connected with the owner for initialization
        const owner = signers[0];
        const gameContractWithOwner = gameContract.connect(owner);
        
        // Initialize arrays to store weekly data for visualization
        const data = {
            retailer: [],
            wholesaler: [],
            distributor: [],
            factory: [],
            weeks: weeks
        };
        
        // Previous total costs for calculating weekly costs
        const prevTotalCosts = {
            retailer: 0,
            wholesaler: 0,
            distributor: 0,
            factory: 0
        };
        
        console.log("Game already initialized, starting simulation...");
        
        // Process weeks
        let lastRetailerOrderAmount = 0;
        let lastWholesalerOrderAmount = 0;
        
        for (let week = 0; week < weeks; week++) {
            console.log(`\n-------- WEEK ${week} --------`);
            
            // Process the current week FIRST (this will handle shipments, etc.)
            console.log(`Processing week ${week}...`);
            await gameContractWithOwner.processWeek();
            
            // Get the current customer demand for the retailer
            const currentDemand = toNumber(await gameContractWithOwner.getCurrentCustomerDemand());
            console.log(`Customer demand for week ${week}: ${currentDemand}`);
            
            // Get current orders from the CSV data for Retailer and Wholesaler
            let retailerOrderAmount = 0;
            let wholesalerOrderAmount = 0;
            
            if (week < orderFlowData.length) {
                retailerOrderAmount = Math.round(orderFlowData[week].retailerOrder);
                
                // For wholesaler, use the next available actual order amount if available
                if (week + 1 < orderFlowData.length) {
                    wholesalerOrderAmount = Math.round(orderFlowData[week + 1].wholesalerOrder);
                }
            }
            
            // Save the order amounts for the next week if no data is available
            if (retailerOrderAmount === 0 && week > 0) {
                retailerOrderAmount = lastRetailerOrderAmount;
            }
            
            if (wholesalerOrderAmount === 0 && week > 0) {
                wholesalerOrderAmount = lastWholesalerOrderAmount;
            }
            
            // Save current order amounts for the next iteration
            lastRetailerOrderAmount = retailerOrderAmount;
            lastWholesalerOrderAmount = wholesalerOrderAmount;
            
            // Place orders for each role: Retailer and Wholesaler use fixed orders from CSV data
            // Distributor and Factory use algorithmic model
            console.log("Placing orders for all roles...");
            
            // For Retailer - use fixed order from CSV
            console.log("Retailer placing order...");
            const retailerOrderResult = await placeFixedOrder(
                gameContractWithOwner, 
                signers[Role.RETAILER], 
                Role.RETAILER, 
                retailerOrderAmount
            );
            
            // For Wholesaler - use fixed order from CSV as well
            console.log("Wholesaler placing order...");
            const wholesalerOrderResult = await placeFixedOrder(
                gameContractWithOwner, 
                signers[Role.WHOLESALER], 
                Role.WHOLESALER, 
                wholesalerOrderAmount
            );
            
            // For Distributor - use algorithmic order
            console.log("Distributor placing order...");
            const distributorOrderResult = await placeAlgorithmicOrder(
                gameContractWithOwner, 
                signers[Role.DISTRIBUTOR], 
                Role.DISTRIBUTOR, 
                hasBlockchainVisibility
            );
            
            // For Factory - use algorithmic ordering
            console.log("Factory scheduling production...");
            const factoryOrderResult = await scheduleProduction(
                gameContractWithOwner, 
                signers[Role.FACTORY], 
                hasBlockchainVisibility
            );
            
            // Collect data for visualization for each role
            console.log("Collecting data for visualization...");
            const retailerData = await collectWeeklyData(
                gameContractWithOwner, week, "Retailer", Role.RETAILER, 
                retailerOrderResult || 0, prevTotalCosts.retailer
            );
            
            const wholesalerData = await collectWeeklyData(
                gameContractWithOwner, week, "Wholesaler", Role.WHOLESALER, 
                wholesalerOrderResult || 0, prevTotalCosts.wholesaler
            );
            
            const distributorData = await collectWeeklyData(
                gameContractWithOwner, week, "Distributor", Role.DISTRIBUTOR, 
                distributorOrderResult || 0, prevTotalCosts.distributor
            );
            
            const factoryData = await collectWeeklyData(
                gameContractWithOwner, week, "Factory", Role.FACTORY, 
                factoryOrderResult || 0, prevTotalCosts.factory
            );
            
            // Update previous total costs
            if (retailerData && retailerData.totalCost !== undefined) {
                prevTotalCosts.retailer = retailerData.totalCost;
            }
            
            if (wholesalerData && wholesalerData.totalCost !== undefined) {
                prevTotalCosts.wholesaler = wholesalerData.totalCost;
            }
            
            if (distributorData && distributorData.totalCost !== undefined) {
                prevTotalCosts.distributor = distributorData.totalCost;
            }
            
            if (factoryData && factoryData.totalCost !== undefined) {
                prevTotalCosts.factory = factoryData.totalCost;
            }
            
            // Add data to the arrays
            data.retailer.push(retailerData);
            data.wholesaler.push(wholesalerData);
            data.distributor.push(distributorData);
            data.factory.push(factoryData);
            
            console.log(`Week ${week} complete`);
        }
        
        // Get total costs for each role and overall
        const finalCosts = {
            retailer: prevTotalCosts.retailer,
            wholesaler: prevTotalCosts.wholesaler,
            distributor: prevTotalCosts.distributor,
            factory: prevTotalCosts.factory,
            total: prevTotalCosts.retailer + prevTotalCosts.wholesaler + 
                   prevTotalCosts.distributor + prevTotalCosts.factory
        };
        
        // Add cost breakdown to the data
        data.costs = finalCosts;
        
        // Log total costs
        console.log("\n-------- COST SUMMARY --------");
        console.log(`Retailer total cost: ${finalCosts.retailer}`);
        console.log(`Wholesaler total cost: ${finalCosts.wholesaler}`);
        console.log(`Distributor total cost: ${finalCosts.distributor}`);
        console.log(`Factory total cost: ${finalCosts.factory}`);
        console.log(`Overall supply chain cost: ${finalCosts.total}`);
        
        return data;
    } catch (error) {
        console.error(`Error running simulation:`, error);
        return null;
    }
}

/**
 * Run a single simulation with specified parameters
 * @param {Array} orderFlowData - Order flow data from CSV
 * @param {number} periods - Number of periods to run
 * @param {boolean} useBlockchain - Whether to use blockchain visibility
 * @param {string} label - Label for this simulation run
 * @returns {Object} - Simulation results
 */
async function runSimulation(orderFlowData, periods, useBlockchain, label) {
    // Deploy a fresh contract for each simulation
    const BeerGame = await ethers.getContractFactory("BeerDistributionGame");
    const gameContract = await BeerGame.deploy();
    // No need to wait for deployment in Hardhat environment
    console.log(`${label}: Contract deployed at ${gameContract.address}`);
    
    // Get signers for each role
    const signers = await ethers.getSigners();
    const owner = signers[0]; // First signer is the owner
    
    // Set initial inventory (12 units for each role)
    const initialInventory = 12;
    await gameContract.connect(owner).setInitialInventory(initialInventory);
    console.log(`${label}: Set initial inventory to ${initialInventory} for all roles`);
    
    // Extract customer demand data from order flow data
    const customerDemandData = orderFlowData.slice(0, periods).map(entry => Math.round(entry.customerDemand));
    console.log(`Setting custom customer demand pattern: ${customerDemandData.slice(0, 5).join(', ')}...`);

    // First set custom demand pattern
    await gameContract.connect(owner).setCustomDemandPattern(customerDemandData);

    // Then initialize game with CUSTOM demand pattern
    await gameContract.connect(owner).initializeGame(DemandPattern.CUSTOM);
    console.log(`${label}: Game initialized with custom demand pattern`);
    
    // Assign players to roles
    for (let i = 0; i < 4; i++) {
        await gameContract.connect(owner).assignPlayer(signers[i].address, i);
        console.log(`${label}: Assigned signer ${i} to role ${i}`);
    }
    
    // Run the game with the extended hybrid policy
    console.log(`${label}: Starting simulation with ${periods} periods, blockchain visibility: ${useBlockchain}`);
    
    try {
        const results = await runGameWithExtendedHybridPolicy(
            gameContract,
            signers, // Pass all signers, including the owner at index 0
            orderFlowData,
            useBlockchain,
            periods
        );
        
        // Save data in the correct format for visualization
        const visibilityLabel = useBlockchain ? 'blockchain' : 'traditional';
        const dataDir = path.join(__dirname, '../visualization/data/simulations/hybrid');
        const dataPath = path.join(dataDir, `data_${visibilityLabel}_extended_hybrid_${periods}_periods.json`);
        
        // Create the directory if it doesn't exist
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        try {
            fs.writeFileSync(dataPath, JSON.stringify(results, null, 2));
            console.log(`Simulation data saved to ${dataPath}`);
        } catch (err) {
            console.error(`Error saving ${visibilityLabel} data:`, err);
        }
        
        return results;
    } catch (error) {
        console.error(`${label}: Error running simulation:`, error);
        return null;
    }
}

/**
 * Main function to run the simulation
 */
async function main() {
    try {
        console.log("=== Forecasted Crocs Supply Chain Simulation with Extended Hybrid Policy ===");
        
        // Read order flow data from CSV
        const csvPath = '../Forecasted-Crox-Data.csv';
        const orderFlowData = await readOrderFlowData(csvPath);
        
        if (!orderFlowData || orderFlowData.length === 0) {
            console.error("No order flow data found!");
            return;
        }
        
        console.log(`Read ${orderFlowData.length} data points from CSV`);
        
        // Determine the maximum number of periods we can run
        // (based on the number of data points in the CSV)
        const maxPeriods = orderFlowData.length;
        const periodsToRun = Math.min(maxPeriods, 23); // Cap at 23 weeks
        
        console.log(`Will run simulations for ${periodsToRun} periods`);
        
        // Create summary file
        const summaryPath = path.join(__dirname, '../visualization/extended_hybrid_simulation_summary.csv');
        fs.writeFileSync(summaryPath, 'Periods,TraditionalCost,BlockchainCost,CostReduction,CostReductionPercent\n');
        
        // Run traditional simulation (no blockchain visibility)
        console.log("\n--- Running Traditional Simulation (No Blockchain) ---");
        const traditionalResults = await runSimulation(
            orderFlowData,
            periodsToRun,
            false,
            "traditional"
        );
        
        // Run blockchain-enabled simulation
        console.log("\n--- Running Blockchain-Enabled Simulation ---");
        const blockchainResults = await runSimulation(
            orderFlowData,
            periodsToRun,
            true,
            "blockchain"
        );
        
        // Calculate improvements
        if (traditionalResults && blockchainResults) {
            const traditionalTotalCost = traditionalResults.costs.total;
            const blockchainTotalCost = blockchainResults.costs.total;
            
            const costReduction = traditionalTotalCost - blockchainTotalCost;
            const percentageImprovement = (costReduction / traditionalTotalCost) * 100;
            
            console.log("\n=== Extended Hybrid Simulation Results ===");
            console.log(`Traditional Total Cost: ${traditionalTotalCost}`);
            console.log(`Blockchain Total Cost: ${blockchainTotalCost}`);
            console.log(`Cost Reduction: ${costReduction}`);
            console.log(`Percentage Improvement: ${percentageImprovement.toFixed(2)}%`);
            
            // Save to summary CSV
            fs.appendFileSync(
                summaryPath, 
                `${periodsToRun},${traditionalTotalCost},${blockchainTotalCost},${costReduction},${percentageImprovement.toFixed(2)}\n`
            );
            
            console.log(`\nSummary saved to: ${summaryPath}`);
            
            // Print final comparative table
            console.log("\nResults Summary Table:");
            console.log("Periods | Traditional Cost | Blockchain Cost | Cost Reduction | % Reduction");
            console.log("--------|------------------|----------------|---------------|------------");
            console.log(
                `${periodsToRun.toString().padEnd(8)} | ` +
                `${traditionalTotalCost.toString().padEnd(18)} | ` +
                `${blockchainTotalCost.toString().padEnd(16)} | ` +
                `${costReduction.toString().padEnd(15)} | ` +
                `${percentageImprovement.toFixed(2)}%`
            );
            
            // Save summary to JSON as well
            const summary = {
                traditionalTotalCost,
                blockchainTotalCost,
                costReduction,
                percentageImprovement,
                timestamp: new Date().toISOString()
            };
            
            saveDataToJson('../visualization/data/extended-hybrid-summary.json', summary);
        }
    } catch (error) {
        console.error("Error in main function:", error);
    }
}

// Run the main function
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });