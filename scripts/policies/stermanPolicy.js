/**
 * Beer Distribution Game Sterman Heuristic Policy
 * 
 * Implements the Sterman heuristic ordering policy for the Beer Distribution Game
 * based on the formula:
 * 
 * O_t = MAX[0, L_hat_t + alpha_S * (S' - S_t - beta * SL_t)]
 * 
 * Where:
 * - L_hat_t: Expected Incoming Orders (Demand Forecast)
 * - alpha_S: Stock Adjustment Strength
 * - S': Effective Desired Inventory (Anchor)
 * - S_t: Effective Inventory (OnHand - Backlog)
 * - beta: Supply Line Adjustment Fraction (Crucial Misperception Parameter)
 * - SL_t: Supply Line (OnOrder)
 */

// Sterman's mean estimated values to represent average subject behavior
const DEFAULT_PARAMS = {
    theta: 0.36,      // Adaptive expectations weight for demand forecast
    alpha_S: 0.26,    // Stock adjustment strength
    beta: 0.34,       // Supply line adjustment fraction
    S_prime: 0       // Effective desired inventory
};

/**
 * Calculate an order quantity using Sterman's heuristic
 * 
 * @param {Object} data - Order data with current state
 * @returns {number} - Calculated order quantity
 */
function calculateStermanOrder(data) {
    try {
        // Extract base parameters from data
        const onHand = data.onHand || 0;
        const backlog = data.backlog || 0;
        const onOrder = data.onOrder || 0;
        const lastReceivedOrder = data.lastReceivedOrder || 4; // Default to 4 if not available
        const previous_L_hat = data.previous_L_hat || lastReceivedOrder; // Initialize with last order if no forecast
        const role = data.role;
        
        // Get Sterman parameters (use defaults if not provided)
        const params = data.stermanParams || DEFAULT_PARAMS;
        const theta = params.theta !== undefined ? params.theta : DEFAULT_PARAMS.theta;
        const alpha_S = params.alpha_S !== undefined ? params.alpha_S : DEFAULT_PARAMS.alpha_S;
        const beta = params.beta !== undefined ? params.beta : DEFAULT_PARAMS.beta;
        const S_prime = params.S_prime !== undefined ? params.S_prime : DEFAULT_PARAMS.S_prime;
        
        // Log parameters being used
        console.log(`Using Sterman parameters: θ=${theta.toFixed(2)}, α=${alpha_S.toFixed(2)}, β=${beta.toFixed(2)}, S'=${S_prime}`);
        
        // Calculate effective inventory S_t = onHand - backlog
        const effectiveInventory = onHand - backlog;
        console.log(`Effective inventory S_t: ${onHand} - ${backlog} = ${effectiveInventory}`);
        
        // Calculate expected incoming orders using adaptive expectations L_hat_t
        const L_hat_t = theta * lastReceivedOrder + (1 - theta) * previous_L_hat;
        console.log(`Expected orders L_hat_t: ${theta.toFixed(2)} * ${lastReceivedOrder} + (1 - ${theta.toFixed(2)}) * ${previous_L_hat.toFixed(2)} = ${L_hat_t.toFixed(2)}`);
        
        // Apply the main heuristic equation
        // O_t = MAX[0, L_hat_t + alpha_S * (S' - S_t - beta * SL_t)]
        const supplyLineAdjustment = beta * onOrder;
        const inventoryDiscrepancy = S_prime - effectiveInventory - supplyLineAdjustment;
        const inventoryAdjustment = alpha_S * inventoryDiscrepancy;
        
        console.log(`Supply line adjustment: ${beta.toFixed(2)} * ${onOrder} = ${supplyLineAdjustment.toFixed(2)}`);
        console.log(`Inventory discrepancy: ${S_prime} - ${effectiveInventory} - ${supplyLineAdjustment.toFixed(2)} = ${inventoryDiscrepancy.toFixed(2)}`);
        console.log(`Inventory adjustment: ${alpha_S.toFixed(2)} * ${inventoryDiscrepancy.toFixed(2)} = ${inventoryAdjustment.toFixed(2)}`);
        
        // Calculate indicated order quantity
        const indicatedOrder = L_hat_t + inventoryAdjustment;
        console.log(`Indicated order: ${L_hat_t.toFixed(2)} + ${inventoryAdjustment.toFixed(2)} = ${indicatedOrder.toFixed(2)}`);
        
        // Apply MAX[0, ...] and round to nearest integer
        const finalOrder = Math.max(0, Math.round(indicatedOrder));
        console.log(`Final order: MAX[0, ${indicatedOrder.toFixed(2)}] = ${finalOrder}`);

        // Return both the order and updated forecast for next period
        return {
            order: finalOrder,
            updated_L_hat: L_hat_t
        };
    } catch (error) {
        console.error('Error calculating Sterman order:', error);
        // Return a reasonable default order (4) in case of error
        return {
            order: 4,
            updated_L_hat: 4
        };
    }
}

/**
 * Original blockchain order calculation (now commented out)
 * 
 * When blockchain visibility is enabled, this implements "Variation A" of Sterman's heuristic
 * where the demand forecast is improved with end-customer demand information, but
 * the behavioral parameters (alpha_S, beta, S') remain unchanged.
 * 
 * This isolates the benefit of improved demand information only.
 */
/*
function calculateStermanBlockchainOrder(data) {
    try {
        console.log('Executing Sterman Policy with Blockchain Data (Variation A) - OLD');
        
        // Extract base parameters from data
        const onHand = data.onHand || 0;
        const backlog = data.backlog || 0;
        const onOrder = data.onOrder || 0;
        
        // Use the default behavioral parameters (mean estimated values)
        const alpha_S = DEFAULT_PARAMS.alpha_S; // 0.26
        const beta = DEFAULT_PARAMS.beta;       // 0.34
        const S_prime = DEFAULT_PARAMS.S_prime; // 17
        
        console.log(`Using standard behavioral parameters: α=${alpha_S.toFixed(2)}, β=${beta.toFixed(2)}, S'=${S_prime}`);
        
        // Use smoothed end-customer demand as the forecast (L_hat_t)
        // This is the key difference in Variation A - better forecast from blockchain visibility
        const L_hat_t = data.smoothedEndCustomerDemand || 4; // Default to 4 if not available
        console.log(`Using smoothed end-customer demand as forecast L_hat_t = ${L_hat_t.toFixed(2)}`);
        
        // Calculate effective inventory S_t = onHand - backlog
        const effectiveInventory = onHand - backlog;
        console.log(`Effective inventory S_t: ${onHand} - ${backlog} = ${effectiveInventory}`);
        
        // Apply the main heuristic equation with default parameters
        // O_t = MAX[0, L_hat_t + alpha_S * (S' - S_t - beta * SL_t)]
        const supplyLineAdjustment = beta * onOrder;
        const inventoryDiscrepancy = S_prime - effectiveInventory - supplyLineAdjustment;
        const inventoryAdjustment = alpha_S * inventoryDiscrepancy;
        
        console.log(`Supply line adjustment: ${beta.toFixed(2)} * ${onOrder} = ${supplyLineAdjustment.toFixed(2)}`);
        console.log(`Inventory discrepancy: ${S_prime} - ${effectiveInventory} - ${supplyLineAdjustment.toFixed(2)} = ${inventoryDiscrepancy.toFixed(2)}`);
        console.log(`Inventory adjustment: ${alpha_S.toFixed(2)} * ${inventoryDiscrepancy.toFixed(2)} = ${inventoryAdjustment.toFixed(2)}`);
        
        // Calculate indicated order quantity
        const indicatedOrder = L_hat_t + inventoryAdjustment;
        console.log(`Indicated order: ${L_hat_t.toFixed(2)} + ${inventoryAdjustment.toFixed(2)} = ${indicatedOrder.toFixed(2)}`);
        
        // Apply MAX[0, ...] and round to nearest integer
        const finalOrder = Math.max(0, Math.round(indicatedOrder));
        console.log(`Final order: MAX[0, ${indicatedOrder.toFixed(2)}] = ${finalOrder}`);
        
        // Return both the order and updated forecast for next period
        return {
            order: finalOrder,
            updated_L_hat: L_hat_t // In this old version, L_hat was directly the smoothed demand
        };
    } catch (error) {
        console.error('Error calculating (OLD) blockchain-enhanced Sterman order (Variation A):', error);
        return {
            order: 4,
            updated_L_hat: 4
        };
    }
}
*/

/**
 * NEW Modified version of Sterman's heuristic with blockchain visibility.
 * 
 * The demand forecast (L_hat_t) is calculated using adaptive expectations,
 * similar to the traditional mode, but uses unsmoothed current end-customer demand
 * as the "last received order" signal. Behavioral parameters (alpha_S, beta, S') 
 * remain standard (DEFAULT_PARAMS).
 */
function calculateStermanBlockchainOrder(data) {
    try {
        console.log('Executing Sterman Policy with Blockchain Data (NEW - Adaptive L_hat_t)');
        
        // Extract base parameters from data
        const onHand = data.onHand || 0;
        const backlog = data.backlog || 0;
        const onOrder = data.onOrder || 0;
        
        // Get the player's forecast from the previous week (passed as previous_L_hat).
        // Default to currentEndCustomerDemandForLhat if previous_L_hat is not available (e.g., week 0 or initialization).
        const previous_L_hat = data.previous_L_hat || data.currentEndCustomerDemandForLhat || 4;
        
        // Get the unsmoothed current end-customer demand (passed as currentEndCustomerDemandForLhat).
        // This will be used as the equivalent of "lastReceivedOrder" in the L_hat_t adaptive expectations formula.
        const currentEndCustomerDemand = data.currentEndCustomerDemandForLhat || 4; // Default to 4 if not available

        // Use default Sterman behavioral parameters (theta, alpha_S, beta, S_prime)
        const theta = DEFAULT_PARAMS.theta;
        const alpha_S = DEFAULT_PARAMS.alpha_S;
        const beta = DEFAULT_PARAMS.beta;
        const S_prime = DEFAULT_PARAMS.S_prime;
        
        console.log(`Using Sterman parameters: θ=${theta.toFixed(2)}, α=${alpha_S.toFixed(2)}, β=${beta.toFixed(2)}, S'=${S_prime}`);
        console.log(`Blockchain L_hat inputs: currentEndCustomerDemand = ${currentEndCustomerDemand}, previous_L_hat = ${previous_L_hat.toFixed(2)}`);

        // Calculate effective inventory S_t = onHand - backlog
        const effectiveInventory = onHand - backlog;
        console.log(`Effective inventory S_t: ${onHand} - ${backlog} = ${effectiveInventory}`);
        
        // Calculate expected incoming orders (L_hat_t) using adaptive expectations:
        // L_hat_t = theta * currentEndCustomerDemand + (1 - theta) * previous_L_hat
        const L_hat_t = theta * currentEndCustomerDemand + (1 - theta) * previous_L_hat;
        console.log(`Expected orders L_hat_t (blockchain): ${theta.toFixed(2)} * ${currentEndCustomerDemand} + (1 - ${theta.toFixed(2)}) * ${previous_L_hat.toFixed(2)} = ${L_hat_t.toFixed(2)}`);
        
        // Apply the main heuristic equation:
        // O_t = MAX[0, L_hat_t + alpha_S * (S' - S_t - beta * SL_t)]
        const supplyLineAdjustment = beta * onOrder;
        const inventoryDiscrepancy = S_prime - effectiveInventory - supplyLineAdjustment;
        const inventoryAdjustment = alpha_S * inventoryDiscrepancy;
        
        console.log(`Supply line adjustment: ${beta.toFixed(2)} * ${onOrder} = ${supplyLineAdjustment.toFixed(2)}`);
        console.log(`Inventory discrepancy: ${S_prime} - ${effectiveInventory} - ${supplyLineAdjustment.toFixed(2)} = ${inventoryDiscrepancy.toFixed(2)}`);
        console.log(`Inventory adjustment: ${alpha_S.toFixed(2)} * ${inventoryDiscrepancy.toFixed(2)} = ${inventoryAdjustment.toFixed(2)}`);
        
        // Calculate indicated order quantity
        const indicatedOrder = L_hat_t + inventoryAdjustment;
        console.log(`Indicated order: ${L_hat_t.toFixed(2)} + ${inventoryAdjustment.toFixed(2)} = ${indicatedOrder.toFixed(2)}`);
        
        // Apply MAX[0, ...] and round to nearest integer
        const finalOrder = Math.max(0, Math.round(indicatedOrder));
        console.log(`Final order: MAX[0, ${indicatedOrder.toFixed(2)}] = ${finalOrder}`);
        
        // Return both the order and the updated forecast (L_hat_t) for the next period
        return {
            order: finalOrder,
            updated_L_hat: L_hat_t 
        };
    } catch (error) {
        console.error('Error calculating (NEW) blockchain-enhanced Sterman order (Adaptive L_hat_t):', error);
        // Return a reasonable default order (4) in case of error
        return {
            order: 4,
            updated_L_hat: data.currentEndCustomerDemandForLhat || 4 // Fallback L_hat using current demand
        };
    }
}

module.exports = {
    calculateStermanOrder,
    calculateStermanBlockchainOrder, // This now refers to the new version
    DEFAULT_PARAMS
}; 