# Sterman Simulation Scripts

This directory contains various implementations of the Sterman heuristic for the Beer Distribution Game simulation. Each script represents a different configuration of the supply chain parameters and explores how blockchain visibility affects performance under these conditions.

## Overview of Sterman's Decision Heuristic

All simulations implement Sterman's decision heuristic for inventory management:

```
O_t = MAX[0, L_hat_t + alpha_S * (S' - S_t - beta * SL_t)]
```

Where:
- `O_t` = Order quantity at time t
- `L_hat_t` = Forecast of demand
- `alpha_S` = Supply line adjustment parameter
- `S'` = Desired inventory level
- `S_t` = Current inventory level
- `beta` = Supply line adjustment weight
- `SL_t` = Current supply line (orders placed but not yet received)

## Simulation Variants

### Standard Sterman Model (`sterman-simulation.js`)

The baseline implementation of the Sterman heuristic with the following parameters:
- **Order Delay**: 1 week
- **Shipping Delay**: 1 week
- **Blockchain Implementation**: Compares traditional supply chain vs. blockchain-enabled visibility

### Two-Order Delay Model (`sterman-two-order-delay-simulation.js`)

Explores the impact of increased order processing time:
- **Order Delay**: 2 weeks
- **Shipping Delay**: 1 week
- **Blockchain Implementation**: Compares traditional supply chain vs. blockchain-enabled visibility

### Two-Shipping Delay Model (`sterman-two-shipping-delay-simulation.js`)

Explores the impact of increased shipping time:
- **Order Delay**: 1 week
- **Shipping Delay**: 2 weeks
- **Blockchain Implementation**: Compares traditional supply chain vs. blockchain-enabled visibility

### Zero-Delay Model (`sterman-zero-delay-simulation.js`)

Explores the impact of instant order processing:
- **Order Delay**: 0 weeks (orders are received immediately by the upstream supplier)
- **Shipping Delay**: 1 week
- **Blockchain Implementation**: Compares traditional supply chain vs. blockchain-enabled visibility

### Hybrid Retailer Model (`sterman-hybrid-retailer-simulation.js`)

Explores a partially blockchain-enabled supply chain where only the retailer has blockchain visibility:
- **Order Delay**: 1 week
- **Shipping Delay**: 1 week
- **Blockchain Implementation**: Only the retailer has blockchain visibility

### Hybrid Retailer-Wholesaler Model (`sterman-hybrid-retailer-wholesaler-simulation.js`)

Explores a partially blockchain-enabled supply chain where both the retailer and wholesaler have blockchain visibility:
- **Order Delay**: 1 week
- **Shipping Delay**: 1 week
- **Blockchain Implementation**: Retailer and wholesaler have blockchain visibility

## Running the Simulations

Each script can be run using Hardhat:

```bash
npx hardhat run scripts/sterman/sterman-simulation.js
```

The simulations will:
1. Initialize a new BeerDistributionGame contract
2. Run the simulation with traditional visibility
3. Run the simulation with blockchain-enabled visibility (or hybrid visibility)
4. Save the results to the visualization directory

## Simulation Output

Each simulation generates the following output files in the `visualization/data/simulations/sterman/` directory:

- `traditional.json`: Time series data for the traditional supply chain
- `blockchain.json`: Time series data for the blockchain-enabled supply chain

These files are structured as arrays of weekly data objects containing:
- `week`: The week number
- `inventory`: Array of inventory levels for each role
- `backlog`: Array of backlog values for each role
- `orders`: Array of orders placed by each role
- `incoming`: Array of incoming shipments to each role
- `cost`: Array of weekly costs for each role
- `cumulativeCost`: Array of cumulative costs for each role

## Visualization

The results of these simulations can be visualized using the Sterman visualization tool located at:
`/visualization/sterman-visualization.html`

This visualization provides interactive charts showing:
- Orders placed by role
- Inventory levels by role
- Backlog levels by role
- Weekly costs
- Simulation summary statistics

## Modifying the Simulations

To modify simulation parameters:
1. Adjust the delay parameters in the BeerDistributionGame contract deployment
2. Change the customer demand pattern or load custom demand data
3. Modify the Sterman heuristic parameters in the policies/stermanPolicy.js file 