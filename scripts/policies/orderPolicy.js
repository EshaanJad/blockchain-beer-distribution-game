/**
 * Beer Distribution Game Order Policy
 * 
 * Implements the order policy for the Beer Distribution Game
 * based on the formula:
 * 
 * Order = S - IP
 * Where:
 * - S is the target (base-stock)
 * - IP is the inventory position (OH + OO - BO)
 * 
 * The policy is enhanced with blockchain visibility by incorporating
 * downstream inventory information when available.
 */

// Constants for adjustment factors and thresholds - Default values
const DEFAULT_THRESHOLD_HIGH = 0.75;  // Lowered threshold to more aggressively dampen orders (was 1.1)
const DEFAULT_THRESHOLD_CRITICAL_LOW = 0.5; // Adjust up if downstream has < 50% of target or backlogs
const DEFAULT_MIN_ALPHA = 0.8;       // Increase minimum adjustment factor (was 0.6)
const DEFAULT_MAX_ALPHA = 1.0;       // Maximum adjustment factor for critically low downstream inventory

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
 * 
 * @param {boolean} hasBlockchainVisibility - Whether blockchain visibility is enabled
 * @param {number} downstreamIP - Downstream inventory position
 * @param {number} downstreamS - Downstream target
 * @param {number} downstreamBacklog - Downstream backlog
 * @param {Object} tuningParams - Optional tuning parameters
 * @returns {number} - Adjustment factor (alpha)
 */
function calculateAdjustmentFactor(hasBlockchainVisibility, downstreamIP, downstreamS, downstreamBacklog = 0, tuningParams = null) {
    // Set threshold values - use tuning parameters if provided, otherwise use defaults
    const THRESHOLD_HIGH = tuningParams && tuningParams.thresholdHigh ? tuningParams.thresholdHigh : DEFAULT_THRESHOLD_HIGH;
    const THRESHOLD_CRITICAL_LOW = tuningParams && tuningParams.thresholdCriticalLow ? tuningParams.thresholdCriticalLow : DEFAULT_THRESHOLD_CRITICAL_LOW;
    const MIN_ALPHA = tuningParams && tuningParams.minAlpha ? tuningParams.minAlpha : DEFAULT_MIN_ALPHA;
    const MAX_ALPHA = tuningParams && tuningParams.maxAlpha ? tuningParams.maxAlpha : DEFAULT_MAX_ALPHA;
    
    // If tuning parameters are provided, log them
    if (tuningParams) {
        console.log(`Using tuned parameters: TH=${THRESHOLD_HIGH}, TCL=${THRESHOLD_CRITICAL_LOW}, MA=${MIN_ALPHA}, MAX=${MAX_ALPHA}`);
    }
    
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
        const adjustmentFactor = Math.min(MAX_ALPHA + 0.15, 1.0 + (0.15 * backlogRatio));
        console.log(`Downstream has backlog of ${downstreamBacklog} units, using INCREASED adjustment factor: ${adjustmentFactor.toFixed(2)}`);
        return adjustmentFactor;
    }
    
    // If downstream inventory is critically low, increase orders
    if (ratio < THRESHOLD_CRITICAL_LOW) {
        // Calculate how critically low by comparing to threshold
        const criticalGap = THRESHOLD_CRITICAL_LOW - ratio;
        // Scale adjustment factor up to 10% increase based on how far below threshold
        const adjustmentFactor = Math.min(MAX_ALPHA + 0.1, 1.0 + (0.2 * criticalGap));
        console.log(`Downstream has low inventory: ${downstreamIP} < ${downstreamS} × ${THRESHOLD_CRITICAL_LOW}, using INCREASED adjustment factor: ${adjustmentFactor.toFixed(2)}`);
        return adjustmentFactor;
    } else if (ratio > THRESHOLD_HIGH) {
        // Downstream inventory is too high - decrease order to avoid excess
        // Use a dynamic adjustment factor that decreases more as the ratio increases
        const adjustmentFactor = Math.max(MIN_ALPHA, 1.0 - (0.3 * (ratio - THRESHOLD_HIGH)));
        console.log(`Applying REDUCED ordering (α=${adjustmentFactor.toFixed(4)}) due to high downstream inventory: ${downstreamIP} > ${downstreamS} × ${THRESHOLD_HIGH}`);
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
        const tuningParams = orderData.tuningParams || null;
        
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
        let orderQuantity = Math.max(0, baseStockTarget - inventoryPosition);
        console.log(`Initial order: ${baseStockTarget.toFixed(2)} - ${inventoryPosition} = ${orderQuantity.toFixed(2)}`);
        
        // Step 2: Apply blockchain-enabled adjustment based on downstream inventory
        if (orderData.hasBlockchainVisibility) {
            // Extract downstream information
            const downstreamRole = role > 0 ? role - 1 : null;
            
            // Only adjust if we have a valid downstream role (not applicable for retailer)
            if (downstreamRole !== null) {
                // Get downstream inventory position and base stock target
                const downstreamIP = orderData.downstreamIP !== undefined ? orderData.downstreamIP : null;
                const downstreamBacklog = orderData.downstreamBacklog !== undefined ? orderData.downstreamBacklog : 0;
                
                // Calculate downstream base-stock target (if not provided)
                let downstreamTarget;
                if (orderData.downstreamTarget !== undefined) {
                    downstreamTarget = orderData.downstreamTarget;
                } else {
                    // Estimate downstream target based on same formula but with their parameters
                    const downstreamLeadTime = leadTime; // Assume same lead time
                    downstreamTarget = calculateBaseStockTarget(
                        avgDemand,
                        downstreamLeadTime,
                        isConstantDemand,
                        effectiveStdDev,
                        serviceLevel
                    );
                }
                
                // Calculate adjustment factor based on downstream inventory position
                const adjustmentFactor = calculateAdjustmentFactor(
                    orderData.hasBlockchainVisibility,
                    downstreamIP,
                    downstreamTarget,
                    downstreamBacklog,
                    tuningParams
                );
                
                // Apply adjustment factor to order quantity
                const adjustedOrder = Math.max(0, orderQuantity * adjustmentFactor);
                console.log(`Adjusted order: ${orderQuantity.toFixed(2)} × ${adjustmentFactor.toFixed(2)} = ${adjustedOrder.toFixed(2)}`);
                
                // Update order quantity with adjusted value
                orderQuantity = adjustedOrder;
            } else {
                console.log(`Role ${role} (Retailer) has no downstream, no blockchain adjustment applied`);
            }
        }
        
        // Step 3: Round to whole number for placing order
        orderQuantity = Math.round(orderQuantity);
        console.log(`Final order quantity: ${orderQuantity}`);
        
        return orderQuantity;
    } catch (error) {
        console.error("Error in calculateOrder:", error);
        // Return a reasonable default order in case of error
        return 4;
    }
}

/**
 * Calculate production quantity for Factory
 * (uses the same logic as calculateOrder)
 * 
 * @param {Object} data - Factory data with current state
 * @returns {number} - Calculated production quantity
 */
function calculateProduction(data) {
    try {
        return calculateOrder(data);
    } catch (error) {
        console.error("Error in calculateProduction:", error);
        return 4;
    }
}

module.exports = {
    calculateOrder,
    calculateProduction,
    calculateBaseStockTarget,  // Export for testing
    calculateLocalInventoryPosition,  // Export for testing
    calculateAdjustmentFactor  // Export for testing
}; 