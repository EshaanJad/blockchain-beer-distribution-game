# Beer Distribution Game on Ethereum Blockchain

This project implements the classic Beer Distribution Game on the Ethereum blockchain using Solidity to research the impact of blockchain-enabled visibility on supply chain performance.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v16+ and npm
- [Python 3](https://www.python.org/downloads/) for visualization server

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd beer-distribution-game

# Install dependencies
npm install

# Compile contracts
npx hardhat compile
```

### Running Sterman Simulations

The project includes several Sterman model simulations with different configurations:

```bash
# Standard Sterman model (1 week order delay, 1 week shipping delay)
npx hardhat run scripts/sterman/sterman-simulation.js

# Two-order delay model (2 week order delay, 1 week shipping delay)
npx hardhat run scripts/sterman/sterman-two-order-delay-simulation.js

# Two-shipping delay model (1 week order delay, 2 week shipping delay)
npx hardhat run scripts/sterman/sterman-two-shipping-delay-simulation.js

# Zero-delay model (0 week order delay, 1 week shipping delay)
npx hardhat run scripts/sterman/sterman-zero-delay-simulation.js

# Hybrid retailer model (only retailer has blockchain visibility)
npx hardhat run scripts/sterman/sterman-hybrid-retailer-simulation.js

# Hybrid retailer-wholesaler model (retailer and wholesaler have blockchain visibility)
npx hardhat run scripts/sterman/sterman-hybrid-retailer-wholesaler-simulation.js
```

### Viewing Sterman Visualizations

After running the simulations, view the results using the Sterman visualization tool:

```bash
# Start a web server from the root directory
cd beer-distribution-game
python3 -m http.server 8000

# If python3 doesn't work, try:
python -m http.server 8000
```

Then open your browser and navigate to:
```
http://localhost:8000/visualization/sterman-visualization.html
```

## Sterman Visualization Features

The Sterman visualization tool provides:

- **Simulation Selection**: Choose between different simulation types (standard, two-order-delay, two-shipping-delay, zero-delay, hybrid models)
- **Simulation Settings**: View configuration parameters for each simulation
- **Results Comparison**: Compare the performance of traditional vs. blockchain-enabled supply chains
- **Detailed Charts**:
  - Orders Placed by Role (Traditional)
  - Orders Placed by Role (Blockchain)
  - Inventory Levels by Role (Traditional)
  - Inventory Levels by Role (Blockchain)
  - Backlog Levels by Role (Traditional)
  - Backlog Levels by Role (Blockchain)
  - Weekly Costs Comparison

## Project Structure

For more detailed information about the project, see the following README files:

- `/scripts/sterman/README.md`: Detailed explanation of Sterman simulation scripts
- `/visualization/README.md`: Information about all visualization components
- `/visualization/data/simulations/sterman/README.md`: Details about the Sterman simulation data format

## Overview

The Beer Distribution Game is a simulation of a supply chain with four roles:
- Retailer: Sells products to end customers
- Wholesaler: Supplies retailers
- Distributor: Supplies wholesalers
- Factory: Manufactures products and supplies distributors

Orders flow upstream (Retailer → Factory) and shipments flow downstream (Factory → Retailer).

This implementation allows comparison between traditional supply chain operation (limited visibility) and blockchain-enabled supply chain with full visibility of all entities.

## Research Purpose

This implementation quantifies the impact of blockchain-enabled visibility on supply chain performance:
1. **Traditional Supply Chain**: Limited visibility where each player only sees orders from their immediate downstream partner
2. **Blockchain-Enabled Supply Chain**: Full visibility of end-customer demand and inventory positions across the entire chain

The primary metrics evaluated are:
- Total supply chain cost (inventory holding + backlog penalty costs)
- Bullwhip effect mitigation
- Service level improvements

## Project Structure

- `/contracts`: Smart contract code
  - `BeerDistributionGame.sol`: Core contract implementing the beer distribution game mechanics
- `/scripts`: Simulation scripts and order policies
  - `/sterman`: Sterman heuristic simulation scripts with various delay configurations
  - `policies/`: Base-stock ordering policy implementations
  - Various simulation scripts with different delay patterns and hybrid configurations
- `/visualization`: Interactive data visualization tools
  - `visualization.html`: Original visualization dashboard
  - `sterman-visualization.html`: Dedicated dashboard for Sterman simulations
  - `data/`: Organized simulation results

## Alternative Web Servers

If Python is not available, you can use these alternatives:

1. **Node.js http-server**:
```bash
# Install globally
npm install -g http-server

# Run from project directory
cd beer-distribution-game
http-server -p 8000
```

2. **Visual Studio Code Live Server**:
   - Install the "Live Server" extension in VS Code
   - Right-click on visualization/sterman-visualization.html and select "Open with Live Server"

3. **PHP Built-in Server** (if PHP is installed):
```bash
cd beer-distribution-game
php -S localhost:8000
```

## Simulation Parameters

Key parameters that can be adjusted in the simulation scripts:

- **Initial Inventory**: Default is 40 units for all roles (`setInitialInventory(40)`)
- **Order Delay**: Periods for orders to reach upstream supplier (0-2 weeks)
- **Shipping Delay**: Periods for shipments to reach downstream partner (1-2 weeks)
- **Alpha (α)**: Smoothing factor for exponential demand forecasting (0.2-0.8)
- **Safety Stock Threshold**: Multiplier for standard deviation in safety stock calculation

## Input Data

The simulation uses two primary data sources:

- `Std_Order_Quantities.csv`: Contains the customer demand data from Crocs supply chain
- `Order_Flow_History.csv`: Historical order flow data for certain simulations

## Ordering Policy Algorithm

The base-stock ordering policy is implemented in JavaScript and follows these steps:

1. **Calculate base-stock target level** accounting for lead time, demand mean, variability, and service level
2. **Calculate local inventory position** = On-hand + On-order - Backorders
3. **Calculate initial order quantity** = max(0, base-stock target - inventory position)
4. **Apply adjustment factor (α)** based on blockchain visibility:
   - Without blockchain: Uses only local information
   - With blockchain: Adjusts based on end-customer demand and downstream inventory positions
5. **Calculate final order** = Initial order × adjustment factor

## Cost Structure

The game uses a simple cost structure:
- **Holding Cost**: $1 per unit per period for inventory
- **Backlog Cost**: $2 per unit per period for unfulfilled orders

Total cost is the sum of holding and backlog costs across all roles and time periods.

## Simulation Types

### Standard Simulation
All supply chain members use algorithmic ordering policies with the same demand forecasting method.

### Hybrid Simulations
Some members use fixed historical order quantities while others use base-stock policies:
- **Hybrid**: Retailer uses fixed orders, other roles use algorithms
- **Extended Hybrid**: Retailer and Wholesaler use fixed orders, Distributor and Factory use algorithms
- **Triple Hybrid**: Only Factory uses algorithmic policy, all others use fixed orders

### Delay Variants
Different combinations of order and shipping delays to simulate various supply chain configurations:
- **Standard**: 1 week order + 1 week shipping delay
- **Zero Order Delay**: 0 week order + 1 week shipping delay
- **One-Two Delay**: 1 week order + 2 week shipping delay
- **Two-One Delay**: 2 week order + 1 week shipping delay
- **Two Week Delay**: 0 week order + 2 week shipping delay

## License

MIT 