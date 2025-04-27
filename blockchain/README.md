# Blockchain Implementation for Beer Distribution Game

This directory contains the blockchain-related components used to implement transparent information sharing in the Beer Distribution Game simulation. The blockchain technology enables real-time visibility across the supply chain, allowing participants to make more informed decisions.

## Core Components

### blockchainNetwork.js

Defines the blockchain network structure and connectivity between supply chain nodes.

**Key features:**
- Network initialization and configuration
- Node registration and authentication
- Consensus mechanism implementation
- Network resiliency and fault tolerance

### smartContracts.js

Smart contract implementations for managing supply chain transactions and data sharing.

**Key features:**
- Order contract with automatic verification
- Inventory tracking contract
- Shipment verification contract
- Access control for information visibility

### ledger.js

Implementation of the distributed ledger that stores all transaction data.

**Key features:**
- Block structure definition
- Cryptographic validation
- Data persistence across nodes
- Historical transaction query capabilities

## Blockchain Visibility Modes

### Full Visibility

In this mode, all supply chain participants have access to real-time information:
- Current inventory levels across all roles
- In-transit shipment status
- Incoming and outgoing orders
- Production schedules

### Partial Visibility

Configurable restrictions on information sharing:
- Upstream visibility: only see information from upstream partners
- Downstream visibility: only see information from downstream partners
- Time-delayed visibility: see information with a configurable time delay
- Aggregated visibility: see summary information without specific details

## Integration with Simulation

### blockchainConnector.js

Connects the blockchain implementation with the core simulation engine.

**Key features:**
- Event synchronization between simulation and blockchain
- Transaction batching for efficiency
- Error handling and recovery
- Performance optimization

### visibilityManager.js

Manages what information is accessible to each role based on visibility settings.

**Key features:**
- Role-based access control
- Information filtering
- Dynamic visibility rule updates
- Compliance with visibility contracts

## Cross-Platform Compatibility

The blockchain implementation works across all major operating systems (macOS, Linux, Windows) with no platform-specific adaptations needed. All components are built on Node.js, which provides consistent behavior across platforms.

### Windows-Specific Notes

- All file paths in JavaScript code use forward slashes (`/`) for cross-platform compatibility
- If you encounter path-related issues on Windows, ensure you're using the Node.js path module which handles cross-platform path differences automatically
- Network connections use standard TCP/IP and don't require special firewall configurations beyond what's needed for Node.js applications

## Performance Considerations

The blockchain implementation is optimized for:

1. **Throughput**: Handling high transaction volumes during simulation
2. **Latency**: Minimizing delay for real-time decision making
3. **Storage**: Efficient data structure for historical transactions
4. **Scalability**: Supporting additional nodes and roles

## Security Features

1. **Transaction Verification**: Cryptographic verification of all transactions
2. **Immutability**: Prevention of retroactive data modification
3. **Audit Trail**: Complete historical record of all changes
4. **Access Controls**: Granular permissions for data access

## Blockchain vs. Traditional Mode

The simulation can run in either blockchain-enabled or traditional mode:

**Traditional Mode**:
- Each role only sees their own inventory and orders
- Communication limited to adjacent roles
- Information delay between roles
- No visibility into in-transit shipments

**Blockchain Mode**:
- Configurable visibility across the supply chain
- Real-time information updates
- Cryptographically verified transactions
- Tamper-proof historical data

## Implementation Details

### Consensus Mechanism

The simulation uses a simplified Practical Byzantine Fault Tolerance (PBFT) consensus mechanism:
- Low computational requirements
- High transaction throughput
- Deterministic finality
- Suitable for permissioned blockchain networks

### Data Structure

Each blockchain transaction includes:
- Transaction type (order, shipment, inventory update)
- Originating role
- Destination role
- Timestamp
- Quantity
- Status
- Digital signatures

## Usage Example

```javascript
const { initBlockchain } = require('./blockchain/blockchainNetwork');
const { createSupplyChainContract } = require('./blockchain/smartContracts');

// Initialize blockchain network
const network = initBlockchain({
    nodes: ['retailer', 'wholesaler', 'distributor', 'factory'],
    consensusMechanism: 'pbft',
    blockTime: 2000, // ms
    visibilityMode: 'full'
});

// Deploy smart contracts
const supplyChainContract = createSupplyChainContract(network, {
    orderVerification: true,
    inventoryTracking: true,
    shipmentValidation: true
});

// Register event listeners
supplyChainContract.on('OrderPlaced', (event) => {
    console.log(`Order placed from ${event.from} to ${event.to} for ${event.quantity} units`);
});

// Simulate a transaction
supplyChainContract.placeOrder({
    from: 'retailer',
    to: 'wholesaler',
    quantity: 10,
    timestamp: Date.now()
});
```

## Research Applications

The blockchain implementation allows researchers to:

1. **Quantify Value**: Measure the value of information sharing in supply chains
2. **Compare Strategies**: Test different ordering strategies with varying levels of visibility
3. **Analyze Adoption**: Study partial technology adoption scenarios
4. **Measure Trust**: Evaluate the impact of trustworthy information on decision making

## Future Developments

Planned enhancements to the blockchain implementation:
- Integration with actual blockchain networks (Ethereum, Hyperledger)
- Implementation of more complex smart contracts
- Support for IoT sensor data integration
- Dynamic role addition and network reconfiguration 