# Ordering Policies for Beer Distribution Game

This directory contains the ordering policy implementations used in the Beer Distribution Game simulation. These policies determine how each supply chain participant decides order quantities based on their local information and potentially blockchain-enabled visibility.

## Files

### orderPolicy.js

Implements the base-stock ordering policy with demand forecasting. This is the standard policy used in most simulations.

**Key features:**
- Exponential smoothing for demand forecasting
- Base-stock level calculation with safety stock
- Inventory position assessment
- Order adjustments based on visibility

### tunableOrderPolicy.js

An enhanced version of the order policy with tunable parameters for optimization experiments. Used by the alpha tuning scripts to find optimal parameter settings.

**Key features:**
- Configurable alpha (smoothing factor)
- Adjustable safety stock thresholds
- Configurable minimum alpha values
- Performance metric tracking

### runPolicy.js

Coordinates the execution of ordering policies with the BeerDistributionGame smart contract. This file handles:

- Role-specific policy application
- Game progression through time periods
- Data collection and reporting
- Comparison between traditional and blockchain scenarios

## Base-Stock Policy Algorithm

The base-stock policy follows these steps:

1. **Forecast Demand**:
   ```javascript
   forecast = α * currentDemand + (1 - α) * previousForecast
   ```
   where α (alpha) is the smoothing factor between 0 and 1.

2. **Calculate Standard Deviation** of demand:
   ```javascript
   deviation = √(sum((demand - avg)²) / n)
   ```

3. **Calculate Base-Stock Level**:
   ```javascript
   baseStock = forecast * leadTime + safetyFactor * deviation * √leadTime
   ```
   where:
   - `leadTime` is the total of order and shipping delays
   - `safetyFactor` is a multiplier that determines service level

4. **Calculate Inventory Position**:
   ```javascript
   inventoryPosition = onHand + onOrder - backlog
   ```

5. **Calculate Order Quantity**:
   ```javascript
   orderQuantity = max(0, baseStock - inventoryPosition)
   ```

6. **Apply Visibility Adjustment** (with blockchain):
   ```javascript
   adjustment = f(downstream_inventory, customer_demand_trend)
   orderQuantity = orderQuantity * adjustment
   ```

## Visibility Modes

The policies support two visibility modes:

### Traditional Supply Chain

- Only has visibility into incoming orders from immediate downstream partner
- Cannot see end-customer demand (except for retailer)
- Cannot see inventory positions of other roles
- Forecasts solely based on incoming order pattern
- Vulnerable to bullwhip effect due to limited information

### Blockchain-Enabled Supply Chain

- Has visibility into end-customer demand pattern
- Can see inventory positions of all downstream partners
- Can make more informed forecasts
- Can adjust orders based on system-wide information
- Potentially reduces bullwhip effect through information sharing

## Usage

The policies are typically used by the simulation scripts:

```javascript
const runPolicy = require('./policies/runPolicy');
const result = await runPolicy.runGameWithPolicy(
    game,                   // Contract instance
    [retailer, wholesaler, distributor, factory],  // Player accounts
    useBlockchainVisibility, // Boolean for visibility mode
    demandPattern,          // Type of demand pattern
    numberOfPeriods         // Simulation duration
);
```

## Parameter Tuning

For optimal performance, key parameters can be tuned:

- **Alpha (α)**: Controls responsiveness to demand changes (higher = more responsive, but potentially more volatile)
- **Safety Stock Factor**: Controls service level (higher = more safety stock, fewer stockouts, higher holding costs)
- **Minimum Alpha**: Sets a floor for the smoothing factor

The `../executeAlphaTuning.js` script tests various combinations of these parameters to find optimal values. 