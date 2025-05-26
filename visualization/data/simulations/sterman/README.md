# Sterman Simulation Data

This directory contains the simulation results data for the various Sterman heuristic models. Each subdirectory represents a different simulation configuration and contains the output files for both traditional and blockchain-enabled supply chains.

## Directory Structure

- **single/**: Standard Sterman model (Order Delay: 1 week, Shipping Delay: 1 week)
- **two-order-delay/**: Sterman model with 2-week order delay (Order Delay: 2 weeks, Shipping Delay: 1 week)
- **two-shipping-delay/**: Sterman model with 2-week shipping delay (Order Delay: 1 week, Shipping Delay: 2 weeks)
- **zero-delay/**: Sterman model with zero order delay (Order Delay: 0 weeks, Shipping Delay: 1 week)
- **hybrid-retailer/**: Hybrid model where only the retailer has blockchain visibility (Order Delay: 1 week, Shipping Delay: 1 week)
- **hybrid-retailer-wholesaler/**: Hybrid model where retailer and wholesaler have blockchain visibility (Order Delay: 1 week, Shipping Delay: 1 week)

## Data Files

Each subdirectory contains:

- **blockchain.json**: Weekly data for the blockchain-enabled supply chain
- **traditional.json**: Weekly data for the traditional supply chain

## Data Structure

The JSON files are structured as arrays of weekly data objects with the following format:

```json
[
  {
    "week": 0,
    "inventory": [3, 12, 12, 16],
    "backlog": [0, 0, 0, 0],
    "orders": [10, 10, 10, 10],
    "incoming": [0, 0, 0, 0],
    "cost": [1.5, 6, 6, 8],
    "cumulativeCost": [1.5, 6, 6, 8]
  },
  {
    "week": 1,
    "inventory": [0, 6, 6, 20],
    "backlog": [1, 0, 0, 0],
    "orders": [11, 9, 9, 8],
    "incoming": [0, 0, 0, 0],
    "cost": [1, 3, 3, 10],
    "cumulativeCost": [2.5, 9, 9, 18]
  },
  // ... additional weeks
]
```

### Field Descriptions

- **week**: The week number (0-indexed)
- **inventory**: Array of inventory levels for each role [Retailer, Wholesaler, Distributor, Factory]
- **backlog**: Array of backlog values for each role
- **orders**: Array of orders placed by each role
- **incoming**: Array of incoming shipments to each role
- **cost**: Array of weekly costs for each role (inventory holding cost = 0.5/unit, backlog cost = 1.0/unit)
- **cumulativeCost**: Array of cumulative costs for each role up to this week

## Visualization

These data files are used by the `sterman-visualization.html` tool to generate interactive visualizations comparing the performance of traditional and blockchain-enabled supply chains under different simulation parameters.

## Adding New Simulation Data

To add new simulation data:

1. Create a new subdirectory with a descriptive name
2. Add `blockchain.json` and `traditional.json` files in the same format as described above
3. Update the `dataPaths` object in `sterman-visualization.html` to include the new simulation type

## Using the Data for Custom Analysis

The JSON data can be loaded and analyzed using any data analysis tool or programming language that supports JSON, such as:

```javascript
// Example using Node.js
const fs = require('fs');
const path = require('path');

// Load the data
const blockchainData = JSON.parse(fs.readFileSync(path.join(__dirname, 'single/blockchain.json')));
const traditionalData = JSON.parse(fs.readFileSync(path.join(__dirname, 'single/traditional.json')));

// Calculate total cost across all roles for each simulation
const blockchainTotalCost = blockchainData[blockchainData.length - 1].cumulativeCost.reduce((sum, cost) => sum + cost, 0);
const traditionalTotalCost = traditionalData[traditionalData.length - 1].cumulativeCost.reduce((sum, cost) => sum + cost, 0);

// Calculate cost reduction
const costReduction = traditionalTotalCost - blockchainTotalCost;
const costReductionPercent = (costReduction / traditionalTotalCost) * 100;

console.log(`Cost Reduction: ${costReduction} (${costReductionPercent.toFixed(2)}%)`);
``` 