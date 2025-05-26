/**
 * Simple Ordering Policy for the Beer Distribution Game
 * Incorporates an adaptive forecast (L_hat_t) for demand.
 */

// Theta for adaptive expectations, similar to Sterman's policy
const THETA = 0.36;

/**
 * Calculates an order based on the traditional simple policy with adaptive forecast:
 * L_hat_t = THETA * Last_Received_Order_t + (1 - THETA) * Previous_L_hat_t
 * Order_t = max(0, L_hat_t + Current_Backlog_t - Current_Inventory_t)
 * 
 * @param {object} data - Object containing policy inputs.
 * @param {number} data.lastReceivedOrder - Integer. The actual order quantity received from the downstream channel member this period.
 * @param {number} data.previous_L_hat - Float. The demand forecast (L_hat) from the previous period.
 * @param {number} data.currentInventory - Integer. Player's current on-hand inventory.
 * @param {number} data.currentBacklog - Integer. Player's current backlog.
 * @returns {object} - Object containing { orderQuantity: integer, updated_L_hat: float }.
 */
function calculateSimpleTraditionalOrder(data) {
    const { lastReceivedOrder, previous_L_hat, currentInventory, currentBacklog } = data;

    const demandSignal = Number(lastReceivedOrder) || 0;
    const prevForecast = Number(previous_L_hat) || demandSignal; // Initialize forecast with current demand if none exists
    const inventory = Number(currentInventory) || 0;
    const backlog = Number(currentBacklog) || 0;

    const L_hat_t = THETA * demandSignal + (1 - THETA) * prevForecast;
    const orderQuantity = Math.max(0, L_hat_t + backlog - inventory);
    
    // console.log(`SimpleTradPolicy: LRO=${demandSignal}, prevLhat=${prevForecast.toFixed(2)}, Lhat_t=${L_hat_t.toFixed(2)}, Inv=${inventory}, Backlog=${backlog}, Order=${Math.round(orderQuantity)}`);
    return {
        orderQuantity: Math.round(orderQuantity),
        updated_L_hat: L_hat_t
    };
}

/**
 * Calculates an order based on the blockchain simple policy with adaptive forecast:
 * L_hat_t = THETA * Current_End_Customer_Demand_t + (1 - THETA) * Previous_L_hat_t
 * Order_t = max(0, L_hat_t + Current_Backlog_t - Current_Inventory_t)
 * 
 * @param {object} data - Object containing policy inputs.
 * @param {number} data.currentEndCustomerDemandForLhat - Integer. The current end-customer demand (retailer's raw demand).
 * @param {number} data.previous_L_hat - Float. The demand forecast (L_hat) from the previous period.
 * @param {number} data.currentInventory - Integer. Player's current on-hand inventory.
 * @param {number} data.currentBacklog - Integer. Player's current backlog.
 * @returns {object} - Object containing { orderQuantity: integer, updated_L_hat: float }.
 */
function calculateSimpleBlockchainOrder(data) {
    const { currentEndCustomerDemandForLhat, previous_L_hat, currentInventory, currentBacklog } = data;

    const demandSignal = Number(currentEndCustomerDemandForLhat) || 0;
    const prevForecast = Number(previous_L_hat) || demandSignal; // Initialize forecast with current demand if none exists
    const inventory = Number(currentInventory) || 0;
    const backlog = Number(currentBacklog) || 0;
    
    const L_hat_t = THETA * demandSignal + (1 - THETA) * prevForecast;
    const orderQuantity = Math.max(0, L_hat_t + backlog - inventory);

    // console.log(`SimpleBlockchainPolicy: CEDemandLhat=${demandSignal}, prevLhat=${prevForecast.toFixed(2)}, Lhat_t=${L_hat_t.toFixed(2)}, Inv=${inventory}, Backlog=${backlog}, Order=${Math.round(orderQuantity)}`);
    return {
        orderQuantity: Math.round(orderQuantity),
        updated_L_hat: L_hat_t
    };
}

module.exports = {
    calculateSimpleTraditionalOrder,
    calculateSimpleBlockchainOrder
}; 