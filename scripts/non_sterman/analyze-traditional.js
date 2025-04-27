/**
 * Traditional Game Analysis Script for Beer Distribution Game
 * 
 * This script runs the traditional game (without blockchain visibility) for 20 weeks
 * and logs detailed information to help identify what's causing the inflated costs.
 */

const { ethers } = require("hardhat");
const { runGameWithPolicy } = require("./policies/runPolicy");
const fs = require('fs');
const path = require('path');

/**
 * Convert a BigInt to a number for calculation
 * @param {BigInt|number} value - The value to convert
 */
function toNumber(value) {
    if (typeof value === 'bigint') {
        return Number(value);
    }
    return Number(value);
}

/**
 * Format inventory data into a readable summary
 * @param {Object} data - The weekly data for a role
 * @param {number} week - The week number
 * @param {string} roleName - The name of the role
 */
function formatInventorySummary(data, week, roleName) {
    const onHand = data.inventory || 0;
    const backlog = data.backlog || 0;
    const onOrder = data.onOrder || 0;
    const incomingShipment = data.incomingShipment || 0;
    const outgoingShipment = data.outgoingShipment || 0;
    const order = data.order || 0;
    const inventoryPosition = onHand + onOrder - backlog;
    
    return `
    ${roleName} (Week ${week}):
      Inventory: ${onHand} units
      Backlog: ${backlog} units
      On Order: ${onOrder} units
      IP (Inventory Position): ${inventoryPosition} units
      Incoming Shipment: ${incomingShipment} units
      Outgoing Shipment: ${outgoingShipment} units
      Order Placed: ${order} units
      Cost This Week: ${data.weeklyCost || 0} units
    `;
}

async function main() {
    console.log("Starting Beer Distribution Game Analysis - Traditional Mode");
    console.log("=======================================================\n");
    
    // Get signers for different roles
    const [owner, retailer, wholesaler, distributor, factory] = await ethers.getSigners();
    
    console.log("Using accounts:");
    console.log(`Owner: ${owner.address}`);
    console.log(`Retailer: ${retailer.address}`);
    console.log(`Wholesaler: ${wholesaler.address}`);
    console.log(`Distributor: ${distributor.address}`);
    console.log(`Factory: ${factory.address}\n`);
    
    // Deploy the contract
    const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
    const game = await BeerDistributionGame.deploy();
    
    // Define DemandPattern enum values
    const DemandPattern = { CONSTANT: 0, STEP_INCREASE: 1, RANDOM: 2 };

    console.log("Running traditional game (without blockchain visibility, using RANDOM demand)...");
    
    // Run simulation for 20 weeks in traditional mode (no blockchain visibility)
    const result = await runGameWithPolicy(
        game,
        [retailer, wholesaler, distributor, factory],
        false, // No blockchain visibility
        DemandPattern.RANDOM, // Using random demand
        20 // Run for 20 weeks
    );
    
    console.log("\n\n=== TRADITIONAL GAME RESULTS (20 WEEKS) ===\n");
    
    // Extract the data for detailed analysis
    const weeklyData = result.weeklyData;
    
    // Log each week's data for all players
    const roles = ["Retailer", "Wholesaler", "Distributor", "Factory"];
    
    for (let week = 0; week < 20; week++) {
        console.log(`\n===== WEEK ${week} SUMMARY =====`);
        
        // Log customer demand for this week
        const customerDemand = weeklyData.customer ? 
            (weeklyData.customer[week] ? weeklyData.customer[week].demand : "Unknown") : 
            "Unknown";
        
        console.log(`Customer Demand: ${customerDemand} units`);
        
        // Log each role's data for this week
        for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
            const roleName = roles[roleIndex];
            const roleData = weeklyData[roleName.toLowerCase()];
            
            if (roleData && roleData[week]) {
                console.log(formatInventorySummary(roleData[week], week, roleName));
                
                // Special debug for the avgDemand and calculation factors
                if (roleData[week].debugInfo) {
                    console.log(`    Debug Info for ${roleName}:`);
                    Object.entries(roleData[week].debugInfo).forEach(([key, value]) => {
                        console.log(`      ${key}: ${value}`);
                    });
                }
            } else {
                console.log(`    No data available for ${roleName} in week ${week}`);
            }
        }
        
        // Log the weekly total cost
        const weeklyCost = weeklyData.totalCost ? weeklyData.totalCost[week] : "Unknown";
        console.log(`\nTotal Cost for Week ${week}: ${weeklyCost}`);
    }
    
    // Total cost for these 20 weeks
    const totalCost = result.finalCost;
    console.log(`\n\nTotal cost for 20 weeks: ${totalCost}`);
    
    // Save raw data to JSON for further analysis
    const outputPath = path.join(__dirname, '../visualization/analysis_traditional_20weeks.json');
    try {
        fs.writeFileSync(outputPath, JSON.stringify(weeklyData, null, 2));
        console.log(`\nAnalysis data saved to ${outputPath}`);
    } catch (err) {
        console.error("Error saving analysis data:", err);
    }
}

// Execute the simulation
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 