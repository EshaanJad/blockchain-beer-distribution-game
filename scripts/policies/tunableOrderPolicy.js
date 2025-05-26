/**
 * Beer Distribution Game Tunable Order Policy
 * 
 * This is a copy of the original orderPolicy.js modified to accept
 * tuning parameters (thresholdHigh, minAlpha) from the data object
 * instead of using global constants.
 */

// These constants are maintained for backward compatibility but won't be used
// in the tuning experiment. The actual values will come from the data object.
const THRESHOLD_HIGH = 0.75;  // Lowered threshold to more aggressively dampen orders (was 1.1)
const THRESHOLD_CRITICAL_LOW = 0.5; // Adjust up if downstream has < 50% of target or backlogs
const MIN_ALPHA = 0.8;       // Increase minimum adjustment factor (was 0.6)
const MAX_ALPHA = 1.0;       // Maximum adjustment factor for critically low downstream inventory

/**
 * Calculate the base-stock target level
 * 
 * @param {number} avgDemand - Average demand
 * @param {number} leadTime - Lead time (order delay + shipping delay)
 * @param {boolean} isConstantDemand - Whether demand is constant
 * @param {number} demandStdDev - Standard deviation of demand (for random demand)
 * @param {number} serviceLevel - Desired service level (e.g., 0.95, 0.99)
 * @returns {number} - The base-stock target (S)
 */
function calculateBaseStockTarget(avgDemand, leadTime, isConstantDemand = true, demandStdDev = 0, serviceLevel = 0.95) {
    // Ensure values are valid numbers
    avgDemand = avgDemand || 4;
    leadTime = leadTime || 2;
    
    // Base stock target is average demand during lead time
    let baseStockTarget = avgDemand * leadTime;
    console.log(`Base component: ${avgDemand} × ${leadTime} = ${baseStockTarget}`);
    
    // Only add safety stock for non-constant demand
    if (!isConstantDemand) {
        // Check if we have a valid standard deviation
        if (demandStdDev > 0) {
            // Calculate safety factor (Z-score) based on service level
            // Using approximations for common service levels
            let safetyFactor;
            if (serviceLevel <= 0.5) {
                safetyFactor = 0; // No safety stock for 50% or lower
            } else if (serviceLevel <= 0.84) {
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
            console.log(`Using safety factor ${safetyFactor} for service level ${serviceLevel}`);
            
            // Safety stock formula: safety factor * standard deviation of demand during lead time
            // Standard deviation of demand during lead time = standard deviation of demand * sqrt(lead time)
            const safetyStock = safetyFactor * demandStdDev * Math.sqrt(leadTime);
            
            baseStockTarget += safetyStock;
            console.log(`Adding safety stock of ${safetyStock.toFixed(2)} units (${safetyFactor} × ${demandStdDev.toFixed(2)} × √${leadTime})`);
            console.log(`Final target: ${baseStockTarget.toFixed(2)} units (base + safety stock)`);
        } else {
            console.log(`ISSUE: No safety stock added because demandStdDev (${demandStdDev}) is zero or negative for non-constant demand pattern`);
        }
    } else {
        console.log(`No safety stock added: demand is considered constant`);
    }
    
    return baseStockTarget;
}

/**
 * Calculate the local inventory position
 * 
 * @param {number} onHand - On-hand inventory
 * @param {number} onOrder - On-order inventory (in pipeline)
 * @param {number} backlog - Backlogged orders
 * @returns {number} - Local inventory position
 */
function calculateLocalInventoryPosition(onHand, onOrder, backlog) {
    return (onHand || 0) + (onOrder || 0) - (backlog || 0);
}

/**
 * Calculate the adjustment factor based on downstream inventory position
 * MODIFIED to use tunable parameters from data object
 * 
 * @param {boolean} hasBlockchainVisibility - Whether blockchain visibility is enabled
 * @param {number} downstreamIP - Downstream inventory position
 * @param {number} downstreamS - Downstream target
 * @param {number} downstreamBacklog - Downstream backlog
 * @param {number} thresholdHigh - High threshold for adjustment (from data object)
 * @param {number} minAlpha - Minimum adjustment factor (from data object)
 * @returns {number} - Adjustment factor (alpha)
 */
function calculateAdjustmentFactor(hasBlockchainVisibility, downstreamIP, downstreamS, downstreamBacklog = 0, thresholdHigh = 0.75, minAlpha = 0.8) {
    // Using the passed-in parameters instead of global constants
    const THRESHOLD_CRITICAL_LOW = 0.5; // This remains constant
    const MAX_ALPHA = 1.0; // This remains constant
    
    // If no blockchain visibility or invalid downstream data, return default factor
    if (!hasBlockchainVisibility || isNaN(downstreamIP) || isNaN(downstreamS) || downstreamS <= 0) {
        if (!hasBlockchainVisibility) {
            console.log(`No blockchain visibility, using default adjustment factor: 1.0`);
        } else if (isNaN(downstreamIP) || isNaN(downstreamS) || downstreamS <= 0) {
            console.log(`Invalid downstream data (IP: ${downstreamIP}, S: ${downstreamS}), using default adjustment factor: 1.0`);
        }
        return 1.0;
    }
    
    // Calculate the ratio of downstream inventory position to target
    const ratio = downstreamIP / downstreamS;
    
    // Check if downstream has significant backlog
    const hasSignificantBacklog = downstreamBacklog > 0;
    
    // If downstream has significant backlog, increase orders by up to 15%
    if (hasSignificantBacklog) {
        // More aggressive response to backlogs - scale up to 15% increase based on backlog size
        const backlogRatio = downstreamBacklog / downstreamS;
        const adjustmentFactor = Math.min(1.15, 1.0 + (0.15 * backlogRatio));
        console.log(`Downstream has backlog of ${downstreamBacklog} units, using INCREASED adjustment factor: ${adjustmentFactor.toFixed(2)}`);
        return adjustmentFactor;
    }
    
    // If downstream inventory is critically low, increase orders
    if (ratio < THRESHOLD_CRITICAL_LOW) {
        // Calculate how critically low by comparing to threshold
        const criticalGap = THRESHOLD_CRITICAL_LOW - ratio;
        // Scale adjustment factor up to 10% increase based on how far below threshold
        const adjustmentFactor = Math.min(1.1, 1.0 + (0.2 * criticalGap));
        console.log(`Downstream has low inventory: ${downstreamIP} < ${downstreamS} × ${THRESHOLD_CRITICAL_LOW}, using INCREASED adjustment factor: ${adjustmentFactor.toFixed(2)}`);
        return adjustmentFactor;
    } else if (ratio > thresholdHigh) {
        // Downstream inventory is too high - decrease order to avoid excess
        // Use a dynamic adjustment factor that decreases more as the ratio increases
        const adjustmentFactor = Math.max(minAlpha, 1.0 - (0.3 * (ratio - thresholdHigh)));
        console.log(`Applying REDUCED ordering (α=${adjustmentFactor.toFixed(4)}) due to high downstream inventory: ${downstreamIP} > ${downstreamS} × ${thresholdHigh}`);
        return adjustmentFactor;
    } else {
        // Downstream inventory is in normal range
        console.log(`Downstream inventory in normal range, no adjustment needed: ${ratio}`);
        return 1.0;
    }
}

/**
 * Calculate order quantity based on the base-stock model
 * with blockchain visibility adjustments
 * MODIFIED to use tunable parameters
 * 
 * @param {Object} orderData - Order data with current state
 * @returns {number} - Calculated order quantity
 */
function calculateOrder(orderData) {
    try {
        // Extract parameters from orderData
        const onHand = orderData.onHand || 0;
        const onOrder = orderData.onOrder || 0;
        const backlog = orderData.backlog || 0;
        const avgDemand = orderData.avgDemand || 4;
        const leadTime = orderData.leadTime || 2;
        const role = orderData.role;
        const demandPattern = orderData.selectedDemandPattern || 0;
        const serviceLevel = orderData.serviceLevel || 0.95;
        
        // Get the tunable parameters from orderData or use defaults
        const thresholdHigh = orderData.thresholdHigh || THRESHOLD_HIGH;
        const minAlpha = orderData.minAlpha || MIN_ALPHA;
        
        // Determine if demand is considered constant based on demand pattern
        // 0 = CONSTANT, 1 = STEP, 2 = RANDOM
        // For the purposes of safety stock, consider patterns 1 (STEP) and 2 (RANDOM) as non-constant
        const isConstantDemand = demandPattern === 0;
        
        // Calculate inventory position (IP = OH + OO - BO)
        const inventoryPosition = calculateLocalInventoryPosition(onHand, onOrder, backlog);
        
        // Get appropriate standard deviation for safety stock
        let effectiveStdDev = orderData.demandStdDev || 0;
        
        // If we're in traditional mode and don't have a global demandStdDev, use local standard deviation
        if (!orderData.hasBlockchainVisibility && effectiveStdDev <= 0 && orderData.localDemandStdDev > 0) {
            console.log(`Using local demand standard deviation (${orderData.localDemandStdDev.toFixed(2)}) for safety stock calculation`);
            effectiveStdDev = orderData.localDemandStdDev;
        }
        
        // For non-constant demand with missing standard deviation, use a reasonable default
        if (!isConstantDemand && effectiveStdDev <= 0) {
            // Default to 25% of average demand or 1.0, whichever is larger
            effectiveStdDev = Math.max(1.0, avgDemand * 0.25);
            console.log(`No standard deviation available for variable demand pattern (${demandPattern}). Using default: ${effectiveStdDev.toFixed(2)}`);
        }
        
        // Calculate base stock target (S)
        const baseStockTarget = calculateBaseStockTarget(
            avgDemand,
            leadTime,
            isConstantDemand,
            effectiveStdDev,
            serviceLevel
        );
        
        // Step 1: Calculate initial order quantity (S - IP)
        let orderQty = Math.ceil(baseStockTarget - inventoryPosition);
        
        // Step 2 & 3: Check downstream and adjust order if blockchain visibility is available
        if (orderData.hasBlockchainVisibility && 
            orderData.downstreamIP !== undefined && 
            orderData.downstreamS !== undefined) {
            
            const downstreamBacklog = orderData.downstreamData?.backlog || 0;
            
            // Apply adjustment factor based on downstream inventory position
            // Pass the tunable parameters to the function
            const adjustmentFactor = calculateAdjustmentFactor(
                orderData.hasBlockchainVisibility,
                orderData.downstreamIP,
                orderData.downstreamS,
                downstreamBacklog,
                thresholdHigh,  // Pass the tunable threshold high parameter
                minAlpha        // Pass the tunable min alpha parameter
            );
            
            // Adjust the order quantity if needed and if there is an initial order
            if (orderQty > 0 && adjustmentFactor !== 1.0) {
                const originalOrderQty = orderQty;
                orderQty = Math.ceil(orderQty * adjustmentFactor);
                console.log(`Role ${role}: Adjusted order from ${originalOrderQty} to ${orderQty} (factor: ${adjustmentFactor.toFixed(2)}, thresholdHigh: ${thresholdHigh}, minAlpha: ${minAlpha})`);
            }
        }
        
        // Ensure order quantity is non-negative
        orderQty = Math.max(0, orderQty);
        
        console.log(`Role ${role}: Calculated order quantity = ${orderQty}`);
        console.log(`  Base Stock Target (S) = ${baseStockTarget.toFixed(2)}`);
        console.log(`  Inventory Position (IP) = ${inventoryPosition}`);
        console.log(`  Demand Pattern: ${demandPattern}, Is Constant: ${isConstantDemand}, StdDev: ${effectiveStdDev.toFixed(2)}`);
        
        return orderQty;
    } catch (error) {
        console.error('Error in calculateOrder:', error);
        return 0; // Return a safe default on error
    }
}

/**
 * Calculate the production quantity for the factory
 * 
 * @param {Object} data - Production data
 * @returns {number} - Production quantity
 */
function calculateProduction(data) {
    // The factory uses the same logic as other roles for ordering
    return calculateOrder(data);
}

module.exports = {
    calculateOrder,
    calculateProduction,
    calculateBaseStockTarget,  // Export for testing
    calculateLocalInventoryPosition,  // Export for testing
    calculateAdjustmentFactor  // Export for testing
}; 