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
# One-One Delay model (1 week order delay, 1 week shipping delay)
npx hardhat run scripts/sterman/sterman-one-one-delay-simulation.js

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

- **Simulation Selection**: Choose between different simulation types (one-one-delay, two-order-delay, two-shipping-delay, zero-delay, hybrid models)
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

## Input Data

The simulation uses two primary data sources:

- `5pricepoints.csv`: Contains 5 sets of the customer demand data from Crocs supply chain using price points drawn from a normal distribution

## Ordering Policy Algorithm

This project primarily utilizes Sterman's heuristic ordering policy, as implemented in `scripts/policies/stermanPolicy.js`.
The core formula is:

`O_t = MAX[0, L_hat_t + alpha_S * (S' - S_t - beta * SL_t)]`

Where:
- `O_t`: Order quantity for the current period.
- `L_hat_t`: Expected Incoming Orders (Demand Forecast). This is calculated using adaptive expectations: 
  `L_hat_t = theta * lastReceivedOrder + (1 - theta) * previous_L_hat`
  - `theta`: Weight for adaptive expectations in demand forecasting.
  - `lastReceivedOrder`: The actual order quantity received from the downstream partner in the last period.
  - `previous_L_hat`: The demand forecast calculated in the previous period.
- `alpha_S`: Stock Adjustment Strength – how aggressively inventory discrepancies are corrected.
- `S'`: Effective Desired Inventory (Anchor) – the target inventory level.
- `S_t`: Effective Inventory – calculated as `onHandInventory - backlog`.
- `beta`: Supply Line Adjustment Fraction – a factor indicating how much of the current supply line (on-order quantity) is considered when adjusting inventory. This parameter often reflects a common misperception in traditional supply chains.
- `SL_t`: Supply Line – the total quantity of units currently on order but not yet received.

The policy uses default parameters (`DEFAULT_PARAMS` in the script) derived from Sterman's research to represent average subject behavior in the game (e.g., `theta = 0.36`, `alpha_S = 0.26`, `beta = 0.34`, `S' = 0` or another anchor value).

### Blockchain-Enabled Variation

When blockchain visibility is enabled (`calculateStermanBlockchainOrder` function), the policy is modified:
- The core behavioral parameters (`alpha_S`, `beta`, `S'`) remain the same as the traditional mode, reflecting unchanged decision-making heuristics by the players.
- The crucial difference is in the calculation of the demand forecast (`L_hat_t`). Instead of using `lastReceivedOrder` from the immediate downstream partner, the adaptive expectations formula uses the **actual current end-customer demand** (made visible by the blockchain) as the input signal.
  `L_hat_t (blockchain) = theta * currentEndCustomerDemand + (1 - theta) * previous_L_hat`

This allows for a more accurate and timely demand forecast, isolating the impact of improved information visibility while keeping the underlying ordering behavior constant.

## Cost Structure

The game uses a simple cost structure:
- **Holding Cost**: $0.50 per unit per period for inventory
- **Backlog Cost**: $1 per unit per period for unfulfilled orders

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
- **Zero-Zero Delay**: 0 week order + 0 week shipping delay
- **Zero-One Delay**: 0 week order + 1 week shipping delay
- **Zero-Two Delay**: 0 week order + 2 week shipping delay
- **One-Zero Delay**: 1 week order + 0 week shipping delay
- **One-One Delay**: 1 week order + 1 week shipping delay
- **One-Two Delay**: 1 week order + 2 week shipping delay
- **Two-Zero Delay**: 2 week order + 0 week shipping delay
- **Two-One Delay**: 2 week order + 1 week shipping delay
- **Two-Two Delay**: 2 week order + 2 week shipping delay

## License

MIT 
