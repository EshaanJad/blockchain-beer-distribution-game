/**
 * Forecasted Crocs Supply Chain Simulation Script with Hybrid Retailer Policy
 * 
 * This script runs the beer distribution game simulation using forecasted order flow data
 * from the Crocs supply chain, specifically using customer demand and retailer orders from 
 * the "Customer → FL Orders ($)" and "FL → Crocs Orders ($)" columns in the Forecasted-Crox-Data.csv file.
 * 
 * It implements a hybrid policy where:
 * - Customer demand comes from the CSV file
 * - Retailer orders come from the CSV file
 * - Wholesaler, Distributor, and Factory use the algorithmic policy
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
                // Extract customer demand and retailer order from the CSV columns
                const customerDemand = parseFloat(data['Customer → FL Orders ($)']);
                const retailerOrder = parseFloat(data['FL → Crocs Orders ($)']);
                
                // Only push if we have valid numbers
                if (!isNaN(customerDemand) && !isNaN(retailerOrder)) {
                    results.push({
                        customerDemand,
                        retailerOrder
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
 * Place a fixed order for the retailer based on CSV data
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {Signer} signer - Signer for the role
 * @param {number} orderQuantity - Order quantity from CSV
 * @returns {number} - The placed order quantity
 */
async function placeFixedRetailerOrder(gameContract, signer, orderQuantity) {
    try {
        console.log(`Role 0 (Retailer) placing order of ${orderQuantity} units`);
        await gameContract.connect(signer).placeOrder(orderQuantity);
        return orderQuantity;
    } catch (error) {
        console.error("Error in placing fixed retailer order:", error);
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
                
                console.log(`Downstream data - Role: ${downstreamRole}, IP: ${downstreamInventoryPosition}, S: ${downstreamTargetS}, Avg Demand: ${receivedAvgDemand.toFixed(1)}, StdDev: ${receivedOrderStdDev.toFixed(2)}, On-Order: ${downstreamOnOrder}`);
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
        const orderData = await getOrderData(gameContract, Role.FACTORY, hasBlockchainVisibility);
        
        if (orderData.error) {
            console.error(`Error getting order data for factory:`, orderData.error);
            return 0;
        }
        
        const productionQuantity = orderPolicy.calculateOrder(orderData);
        console.log(`Factory scheduling production of ${productionQuantity} units`);
        
        await gameContract.connect(signer).scheduleProduction(productionQuantity);
        return productionQuantity;
    } catch (error) {
        console.error("Error scheduling production:", error);
        return 0;
    }
}

/**
 * Collect weekly data for visualization and analysis
 * @param {Contract} gameContract - The deployed BeerDistributionGame contract
 * @param {number} week - Current week
 * @param {string} roleName - Role name string
 * @param {number} role - Role enum number
 * @param {number} orderPlaced - Order quantity placed this week
 * @param {number} prevTotalCost - Previous total cost
 * @returns {Object} - Weekly data for this role
 */
async function collectWeeklyData(gameContract, week, roleName, role, orderPlaced, prevTotalCost) {
    try {
        // Get member data for this role
        const memberData = await gameContract.getMemberData(role);
        const onHand = toNumber(memberData[0]);
        const backlog = toNumber(memberData[1]);
        
        // Get shipment pipeline
        let onOrder = 0;
        try {
            const shipmentPipeline = await gameContract.getShipmentPipeline(role);
            onOrder = shipmentPipeline.reduce((sum, val) => sum + toNumber(val), 0);
        } catch (error) {
            console.error(`Error getting shipment pipeline for ${roleName}:`, error);
        }
        
        // Get total cost for this player
        const totalCost = await gameContract.getMemberTotalCost(role);
        const totalCostNum = toNumber(totalCost);
        
        // Calculate weekly cost (current - previous)
        const weeklyCost = totalCostNum - prevTotalCost;
        
        return {
            week,
            onHand,
            backlog,
            onOrder,
            orderPlaced,
            weeklyCost,
            totalCost: totalCostNum,
            inventoryPosition: onHand + onOrder - backlog
        };
    } catch (error) {
        console.error(`Error collecting weekly data for ${roleName}:`, error);
        return {
            week,
            error: error.message
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
async function runGameWithHybridPolicy(gameContract, signers, orderFlowData, hasBlockchainVisibility = false, demandPattern = 3, weeks = 52) {
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
    const dataDir = path.join(__dirname, '../visualization/data/simulations/hybrid');
    const dataPath = path.join(dataDir, `data_${visibilityLabel}_forecasted_crocs_hybrid_retailer_${periods}_periods.json`);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Save the data
    saveDataToJson(dataPath, weeklyData);
    
    return {
        totalCost,
        weeklyData
    };
}

async function main() {
    try {
        console.log("Starting Forecasted Crocs Supply Chain Simulations with Hybrid Retailer Policy");
        console.log("===================================================================\n");
        
        // Get signers for reference
        const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
        
        console.log("Using accounts:");
        console.log(`Owner: ${owner.address}`);
        console.log(`Retailer: ${retailer.address}`);
        console.log(`Wholesaler: ${wholesaler.address}`);
        console.log(`Distributor: ${distributor.address}`);
        console.log(`Factory: ${factory.address}\n`);
        
        // Read order flow data from CSV
        const csvFilePath = path.join(__dirname, '../Forecasted-Crox-Data.csv');
        let orderFlowData;
        
        try {
            orderFlowData = await readOrderFlowData(csvFilePath);
            console.log("Successfully loaded order flow data from Forecasted-Crox-Data.csv");
            
            // Calculate statistics for the customer demand data
            if (orderFlowData.length > 1) {
                const customerDemandData = orderFlowData.map(entry => entry.customerDemand);
                const retailerOrderData = orderFlowData.map(entry => entry.retailerOrder);
                
                const customerSum = customerDemandData.reduce((a, b) => a + b, 0);
                const customerAvg = customerSum / customerDemandData.length;
                const customerSquaredDiff = customerDemandData.reduce((sum, d) => sum + Math.pow(d - customerAvg, 2), 0);
                const customerStdDev = Math.sqrt(customerSquaredDiff / customerDemandData.length);
                
                const retailerSum = retailerOrderData.reduce((a, b) => a + b, 0);
                const retailerAvg = retailerSum / retailerOrderData.length;
                const retailerSquaredDiff = retailerOrderData.reduce((sum, d) => sum + Math.pow(d - retailerAvg, 2), 0);
                const retailerStdDev = Math.sqrt(retailerSquaredDiff / retailerOrderData.length);
                
                console.log(`Customer Demand statistics: Avg=${customerAvg.toFixed(2)}, StdDev=${customerStdDev.toFixed(2)}, CV=${(customerStdDev/customerAvg).toFixed(2)}`);
                console.log(`Retailer Order statistics: Avg=${retailerAvg.toFixed(2)}, StdDev=${retailerStdDev.toFixed(2)}, CV=${(retailerStdDev/retailerAvg).toFixed(2)}`);
            }
        } catch (error) {
            console.error("Error reading CSV file:", error);
            console.log("Cannot proceed without order flow data");
            process.exit(1);
        }
        
        // Run simulations with the full 52 periods from forecasted data
        const maxPeriods = orderFlowData.length;
        
        // Create summary file
        const summaryPath = path.join(__dirname, '../visualization/forecasted_hybrid_retailer_simulation_summary.csv');
        fs.writeFileSync(summaryPath, 'Periods,TraditionalCost,BlockchainCost,CostReduction,CostReductionPercent\n');
        
        console.log(`\n\n==========================================`);
        console.log(`SIMULATION WITH ${maxPeriods} PERIODS (full forecasted data)`);
        console.log(`==========================================`);
        
        // Run traditional simulation
        const traditionalResult = await runSimulation(
            orderFlowData, 
            maxPeriods, 
            false, // No blockchain visibility
            `traditional_forecasted_hybrid_retailer_${maxPeriods}`
        );
        
        // Run blockchain simulation
        const blockchainResult = await runSimulation(
            orderFlowData, 
            maxPeriods, 
            true, // With blockchain visibility
            `blockchain_forecasted_hybrid_retailer_${maxPeriods}`
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