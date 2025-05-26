# Smart Contracts for Beer Distribution Game

This directory contains the Solidity smart contracts that implement the Beer Distribution Game simulation on Ethereum.

## Main Contract

### BeerDistributionGame.sol

The core contract that implements the Beer Distribution Game mechanics, including:

- Player roles (Retailer, Wholesaler, Distributor, Factory)
- Order and shipment flows
- Inventory and backlog tracking
- Cost calculations
- Demand pattern generation
- Game state management

## Contract Architecture

The contract is designed to:

1. **Track Game State**: Maintains the current state of the game, including inventory levels, backlog, pending orders, and costs for each role.

2. **Process Orders**: Handles order placement from each role and propagates them through the supply chain.

3. **Process Shipments**: Handles shipment fulfillment based on inventory availability and updates inventory and backlog accordingly.

4. **Calculate Costs**: Calculates and tracks inventory holding costs and backlog penalty costs.

5. **Generate Demand**: Provides different demand pattern options (constant, step increase, random, custom).

6. **Support Visibility Options**: Enables comparison between traditional limited visibility and blockchain full visibility scenarios.

## Development Environment

The contracts are developed using Solidity and can be compiled and deployed using Hardhat, which works cross-platform.

### Windows-Specific Setup

When developing on Windows, ensure you have the following:

1. **Node.js and NPM**: Install from [nodejs.org](https://nodejs.org/)
2. **Windows Build Tools**: Some dependencies may require build tools
   ```powershell
   npm install --global --production windows-build-tools
   ```
3. **Git Bash** (Recommended): For a more Unix-like terminal experience
4. **Hardhat**: Installed via npm as a project dependency

### Potential Windows Issues and Solutions

- **Path Length Limitations**: Windows has a 260 character path limit. If you encounter errors, consider:
  - Moving the project to a shorter path (e.g., `C:\projects\` instead of nested folders)
  - Enabling long paths in Windows 10/11 via Group Policy or registry

- **Line Endings**: Git might convert line endings between Windows (CRLF) and Unix (LF)
  ```powershell
  # Configure Git to handle line endings appropriately
  git config --global core.autocrlf input
  ```

- **PowerShell Execution Policy**: You might need to adjust PowerShell's execution policy
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```

## Key Functions

- **placeOrder**: Allows a player to place an order to their upstream supplier
- **processShipment**: Ships products from a supplier to a downstream partner
- **calculateCosts**: Calculates holding and backlog costs for each player
- **advanceWeek**: Moves the game to the next time period
- **getCustomerDemand**: Retrieves the customer demand for a given week
- **getPlayerInventory**: Gets a player's current inventory level
- **getPlayerBacklog**: Gets a player's current backlog
- **setInitialInventory**: Configures the starting inventory for all players
- **setOrderDelayPeriod**: Sets the delay period for orders (weeks to reach upstream)
- **setShippingDelayPeriod**: Sets the delay period for shipments (weeks to reach downstream)
- **setCustomDemandPattern**: Allows loading custom demand data

## Delay Mechanics

The contract implements configurable delay periods for:

- **Order Delay**: Time it takes for an order to reach the upstream supplier (0-2 weeks)
- **Shipping Delay**: Time it takes for a shipment to reach the downstream customer (1-2 weeks)

These delays create the information and material flow latency that contributes to the bullwhip effect in supply chains.

## Visibility Mechanics

The contract is designed to be used in two modes:

1. **Traditional Mode**: Each player only has access to orders from their immediate downstream partner. This is enforced through access control in the JavaScript ordering policies, not at the contract level.

2. **Blockchain Mode**: All players have visibility into end-customer demand and all inventory positions. This leverages the transparency provided by the blockchain.

## Cost Model

The contract uses a simple cost structure:
- Holding Cost: $1 per unit per period for inventory
- Backlog Cost: $2 per unit per period for unfulfilled orders

## Usage

The contract is typically deployed once and then used by the simulation scripts to run multiple game scenarios with different parameters.

### Example Deployment

```javascript
const BeerDistributionGame = await ethers.getContractFactory("BeerDistributionGame");
const game = await BeerDistributionGame.deploy();
```

### Example Configuration

```javascript
await game.setInitialInventory(40);
await game.setOrderDelayPeriod(1);
await game.setShippingDelayPeriod(1);
await game.setCustomDemandPattern([10, 10, 10, 20, 20, 20, 20, 20]);
``` 