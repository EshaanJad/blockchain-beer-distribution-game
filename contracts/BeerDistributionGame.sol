// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BeerDistributionGame
 * @dev This contract implements the beer distribution game on Ethereum blockchain
 * It allows transparent visibility of all supply chain data for all players
 */
contract BeerDistributionGame is Ownable {
    // Game parameters
    uint256 public constant GAME_LENGTH = 52; // Total number of weeks
    uint256 public initialInventory = 8; // Changed from 0 to 8
    uint256 public holdingCost = 1; // Cost per unit per week
    uint256 public backorderCost = 2; // Cost per unit per week
    uint256 public shippingDelayPeriod = 1; // Time periods of shipping delay
    uint256 public orderDelayPeriod = 1; // Time periods of order delay

    uint256 public currentWeek = 0;
    bool public gameActive = false;
    
    // Demand patterns
    enum DemandPattern { CONSTANT, STEP_INCREASE, RANDOM, CUSTOM }
    DemandPattern public selectedDemandPattern;
    uint256[] public customerDemand;

    // Role types
    enum Role { RETAILER, WHOLESALER, DISTRIBUTOR, FACTORY }
    
    // Simulation cycle phases for tracking state
    enum Phase { 
        WEEK_START,           // Beginning of week (before any processing)
        AFTER_SHIPMENTS,      // After shipment arrivals
        AFTER_ORDERS,         // After order decisions (and after processWeek)
        WEEK_END              // End of week (final state)
    }
    
    // Struct for capturing state snapshots at different phases
    struct StateSnapshot {
        uint256 inventory;
        uint256 backlog;
        uint256 onOrder;      // Calculated from shipment pipeline
        uint256 incomingOrder;
        uint256 outgoingOrder;
        uint256 incomingShipment;
        uint256 outgoingShipment;
        uint256 weeklyCost;   // Total cost incurred during this phase
        uint256 holdingCost;  // Component of the weekly cost from holding inventory
        uint256 backlogCost;  // Component of the weekly cost from backorders
        Phase phase;          // When this snapshot was taken
    }
    
    struct SupplyChainMember {
        address player;
        uint256 currentInventory;
        uint256 backorderedAmount;
        uint256 totalCost;
        uint256[] orderPipeline;
        uint256[] shipmentPipeline;
        uint256[] productionPipeline; // Only for Factory
        uint256 outgoingOrder;
        uint256 outgoingShipment;
        uint256 incomingOrder;
        uint256 incomingShipment;
    }
    
    // Map roles to their respective supply chain members
    mapping(Role => SupplyChainMember) public supplyChainMembers;
    
    // Storage for weekly orders and production
    mapping(Role => mapping(uint256 => uint256)) private weeklyOrders;     // Role => Week => Order amount
    mapping(uint256 => uint256) private weeklyProduction; // Week => Production amount (Factory only)
    
    // Storage for state snapshots at different phases
    mapping(Role => mapping(uint256 => mapping(Phase => StateSnapshot))) public stateSnapshots;

    // Events
    event GameStarted();
    event WeekProcessed(uint256 week);
    event OrderPlaced(Role role, uint256 amount, uint256 week);
    event ShipmentMade(Role from, Role to, uint256 amount, uint256 week);
    event ProductionScheduled(uint256 amount, uint256 week);
    event GameEnded(uint256 totalCost);
    event PlayerAssigned(address player, Role role);
    event StateSnapshotTaken(Role role, uint256 week, Phase phase);

    constructor() Ownable(msg.sender) {}
    
    // Set the initialInventory value (only before game is active)
    function setInitialInventory(uint256 _initialInventory) external onlyOwner {
        require(!gameActive, "Cannot change initial inventory while game is active");
        initialInventory = _initialInventory;
    }
    
    // Set the holdingCost value (only before game is active)
    function setHoldingCost(uint256 _holdingCost) external onlyOwner {
        require(!gameActive, "Cannot change holding cost while game is active");
        holdingCost = _holdingCost;
    }
    
    // Set the backorderCost value (only before game is active)
    function setBackorderCost(uint256 _backorderCost) external onlyOwner {
        require(!gameActive, "Cannot change backorder cost while game is active");
        backorderCost = _backorderCost;
    }
    
    // Set the shippingDelayPeriod value (only before game is active)
    function setShippingDelayPeriod(uint256 _shippingDelayPeriod) external onlyOwner {
        require(!gameActive, "Cannot change shipping delay period while game is active");
        shippingDelayPeriod = _shippingDelayPeriod;
    }
    
    // Set the orderDelayPeriod value (only before game is active)
    function setOrderDelayPeriod(uint256 _orderDelayPeriod) external onlyOwner {
        require(!gameActive, "Cannot change order delay period while game is active");
        orderDelayPeriod = _orderDelayPeriod;
    }
    
    // Set all game parameters at once (only before game is active)
    function setGameParameters(
        uint256 _initialInventory,
        uint256 _holdingCost,
        uint256 _backorderCost,
        uint256 _shippingDelayPeriod,
        uint256 _orderDelayPeriod
    ) external onlyOwner {
        require(!gameActive, "Cannot change game parameters while game is active");
        initialInventory = _initialInventory;
        holdingCost = _holdingCost;
        backorderCost = _backorderCost;
        shippingDelayPeriod = _shippingDelayPeriod;
        orderDelayPeriod = _orderDelayPeriod;
    }
    
    // Initialize the game with default parameters
    function initializeGame(DemandPattern demandPattern) external onlyOwner {
        require(!gameActive, "Game already active");
        
        // Reset game state
        currentWeek = 0;
        
        // Initialize customer demand (only if not using custom pattern that was already set)
        if (demandPattern != DemandPattern.CUSTOM || customerDemand.length == 0) {
            initializeCustomerDemand(demandPattern);
        }
        
        // Create supply chain members
        initializeSupplyChain();
        
        gameActive = true;
        emit GameStarted();
    }
    
    // Assign player addresses to roles
    function assignPlayer(address player, Role role) external onlyOwner {
        require(gameActive, "Game not active");
        require(player != address(0), "Invalid player address");
        
        supplyChainMembers[role].player = player;
        emit PlayerAssigned(player, role);
    }
    
    // Initialize the supply chain with default values
    function initializeSupplyChain() private {
        // Initialize each supply chain member
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            Role role = Role(i);
            
            // Create and initialize order/shipment pipelines
            uint256[] memory orderPipe = new uint256[](orderDelayPeriod + 1);
            uint256[] memory shipmentPipe = new uint256[](shippingDelayPeriod + 1);
            uint256[] memory productionPipe = new uint256[](3); // Production pipeline (for factory)
            
            // Set equilibrium values for pipelines (matching default customer demand)
            uint256 equilibriumFlow = 4;
            
            // Initialize order and shipment pipelines with equilibrium values
            for (uint j = 0; j < orderPipe.length; j++) {
                orderPipe[j] = equilibriumFlow;
            }
            
            for (uint j = 0; j < shipmentPipe.length; j++) {
                shipmentPipe[j] = equilibriumFlow;
            }
            
            supplyChainMembers[role] = SupplyChainMember({
                player: address(0),
                currentInventory: initialInventory, // Using initialInventory (now set to 8)
                backorderedAmount: 0,
                totalCost: 0,
                incomingOrder: 0,
                outgoingOrder: equilibriumFlow, // Set initial outgoing order
                incomingShipment: 0,
                outgoingShipment: 0,
                orderPipeline: orderPipe,
                shipmentPipeline: shipmentPipe,
                productionPipeline: productionPipe
            });
            
            // Initialize factory's production pipeline
            if (role == Role.FACTORY) {
                // Initialize production pipeline with equilibrium values
                uint256[] memory prodPipe = new uint256[](2);
                for (uint j = 0; j < prodPipe.length; j++) {
                    prodPipe[j] = equilibriumFlow;
                }
                supplyChainMembers[role].productionPipeline = prodPipe;
                supplyChainMembers[role].outgoingOrder = equilibriumFlow; // Factory's production order
            }
        }
    }
    
    // Set custom demand pattern with external data
    function setCustomDemandPattern(uint256[] calldata demandValues) external onlyOwner {
        require(!gameActive, "Cannot set demand pattern while game is active");
        require(demandValues.length > 0, "Demand values array cannot be empty");
        
        // Clear existing demand data and set pattern to CUSTOM
        selectedDemandPattern = DemandPattern.CUSTOM;
        delete customerDemand;
        
        // Copy new demand values
        uint256 demandLength = demandValues.length > GAME_LENGTH ? GAME_LENGTH : demandValues.length;
        for (uint256 i = 0; i < demandLength; i++) {
            customerDemand.push(demandValues[i]);
        }
        
        // If provided data is less than GAME_LENGTH, fill the rest with the last value
        if (demandLength < GAME_LENGTH) {
            uint256 lastValue = demandValues[demandLength - 1];
            for (uint256 i = demandLength; i < GAME_LENGTH; i++) {
                customerDemand.push(lastValue);
            }
        }
    }
    
    // Initialize customer demand based on selected pattern
    function initializeCustomerDemand(DemandPattern demandPattern) private {
        selectedDemandPattern = demandPattern;
        delete customerDemand; // Clear existing demand data
        
        if (demandPattern == DemandPattern.CONSTANT) {
            // Constant demand of 4 units per week
            for (uint256 i = 0; i < GAME_LENGTH; i++) {
                customerDemand.push(4);
            }
        } else if (demandPattern == DemandPattern.STEP_INCREASE) {
            // Initial demand of 4 units, then step increase to 8 units at week 5
            for (uint256 i = 0; i < GAME_LENGTH; i++) {
                if (i < 4) {
                    customerDemand.push(4);
                } else {
                    customerDemand.push(8);
                }
            }
        } else if (demandPattern == DemandPattern.RANDOM) {
            // For blockchain implementation, we'll use a predefined "random" sequence
            // In a real implementation, this could use Chainlink VRF or another oracle
            uint256[] memory randomDemand = new uint256[](52);
            // First 25 weeks remain the same but with values 4-12 (increased from 2-6)
            randomDemand[0] = 6;  randomDemand[1] = 10; randomDemand[2] = 4;  randomDemand[3] = 12; randomDemand[4] = 8;
            randomDemand[5] = 6;  randomDemand[6] = 10; randomDemand[7] = 8;  randomDemand[8] = 12; randomDemand[9] = 4;
            randomDemand[10] = 10; randomDemand[11] = 8; randomDemand[12] = 6; randomDemand[13] = 12; randomDemand[14] = 10;
            randomDemand[15] = 8; randomDemand[16] = 4; randomDemand[17] = 6; randomDemand[18] = 10; randomDemand[19] = 12;
            randomDemand[20] = 8; randomDemand[21] = 10; randomDemand[22] = 6; randomDemand[23] = 8; randomDemand[24] = 10;
            // Additional 27 weeks with similar pattern (4-12 range)
            randomDemand[25] = 6; randomDemand[26] = 10; randomDemand[27] = 4; randomDemand[28] = 12; randomDemand[29] = 8;
            randomDemand[30] = 6; randomDemand[31] = 10; randomDemand[32] = 8; randomDemand[33] = 12; randomDemand[34] = 4;
            randomDemand[35] = 10; randomDemand[36] = 8; randomDemand[37] = 6; randomDemand[38] = 12; randomDemand[39] = 10;
            randomDemand[40] = 8; randomDemand[41] = 4; randomDemand[42] = 6; randomDemand[43] = 10; randomDemand[44] = 12;
            randomDemand[45] = 8; randomDemand[46] = 10; randomDemand[47] = 6; randomDemand[48] = 8; randomDemand[49] = 10;
            randomDemand[50] = 6; randomDemand[51] = 8;
            
            for (uint256 i = 0; i < GAME_LENGTH; i++) {
                customerDemand.push(randomDemand[i]);
            }
        }
        // For CUSTOM pattern, demand values should already be set via setCustomDemandPattern
    }
    
    // Place an order as a supply chain member
    function placeOrder(uint256 amount) external {
        require(gameActive, "Game not active");
        Role senderRole = getPlayerRole(msg.sender);
        require(senderRole != Role.FACTORY, "Factory doesn't place orders");
        
        // Find the recipient based on the sender's role
        Role recipientRole = Role(uint(senderRole) + 1);
        
        // Place order in the recipient's order pipeline
        supplyChainMembers[senderRole].outgoingOrder = amount;
        supplyChainMembers[recipientRole].orderPipeline[orderDelayPeriod] += amount;
        
        // Store order for the current week
        weeklyOrders[senderRole][currentWeek] = amount;
        
        emit OrderPlaced(senderRole, amount, currentWeek);
    }
    
    // Process a production order for the factory
    function scheduleProduction(uint256 amount) external {
        require(gameActive, "Game not active");
        require(getPlayerRole(msg.sender) == Role.FACTORY, "Only factory can schedule production");
        
        SupplyChainMember storage factory = supplyChainMembers[Role.FACTORY];
        
        // Add to production pipeline with delay
        factory.productionPipeline[1] += amount; // 1-week production delay
        factory.outgoingOrder = amount;
        
        // Store production for the current week
        weeklyProduction[currentWeek] = amount;
        
        emit ProductionScheduled(amount, currentWeek);
    }
    
    // Process one week of the game
    function processWeek() external onlyOwner {
        require(gameActive, "Game not active");
        require(currentWeek < GAME_LENGTH, "Game has ended");
        
        // PHASE 1: Capture state at beginning of week
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            takeStateSnapshot(Role(i), Phase.WEEK_START);
        }
        
        // Process incoming shipments for all members
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            processIncomingShipments(Role(i));
        }
        
        // Process completed production for factory
        processCompletedProduction(Role.FACTORY);
        
        // PHASE 2: Capture state after shipment arrivals
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            takeStateSnapshot(Role(i), Phase.AFTER_SHIPMENTS);
        }
        
        // Process incoming orders
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            processIncomingOrders(Role(i));
        }
        
        // Process customer demand to retailer
        uint256 customerDemandForWeek = customerDemand[currentWeek];
        processCustomerDemand(customerDemandForWeek);
        
        // PHASE 3: Capture state after order decisions
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            takeStateSnapshot(Role(i), Phase.AFTER_ORDERS);
        }
        
        // Advance all pipelines - this should be done after capturing all states
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            advancePipelines(Role(i));
        }
        
        // Update costs based on the final state of the week
        // This ensures costs are calculated consistently at the end of each week
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            updateCosts(Role(i));
        }
        
        // PHASE 4: Capture final state at end of week
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            takeStateSnapshot(Role(i), Phase.WEEK_END);
        }
        
        currentWeek++;
        emit WeekProcessed(currentWeek);
        
        // Check if game has ended
        if (currentWeek >= GAME_LENGTH) {
            uint256 totalCost = getTotalSupplyChainCost();
            gameActive = false;
            emit GameEnded(totalCost);
        }
    }
    
    // Process incoming shipments
    function processIncomingShipments(Role role) private {
        SupplyChainMember storage member = supplyChainMembers[role];
        uint256 incomingShipmentAmount = member.shipmentPipeline[0];
        
        if (incomingShipmentAmount > 0) {
            // Update for display
            member.incomingShipment = incomingShipmentAmount;
            
            // First apply incoming shipment to backlog if any exists
            uint256 remainingShipment = incomingShipmentAmount;
            
            if (member.backorderedAmount > 0) {
                uint256 toFulfill = member.backorderedAmount <= remainingShipment ? 
                                   member.backorderedAmount : remainingShipment;
                
                // First use shipment to clear backlog
                member.backorderedAmount -= toFulfill;
                remainingShipment -= toFulfill;
                
                // Ship fulfilled backorders if not retailer
                if (role != Role.RETAILER && toFulfill > 0) {
                    shipProduct(role, Role(uint(role) - 1), toFulfill);
                    // Update outgoing shipment for tracking
                    member.outgoingShipment += toFulfill;
                }
            }
            
            // Any remaining shipment goes to inventory
            if (remainingShipment > 0) {
                member.currentInventory += remainingShipment;
            }
        }
    }
    
    // Process completed production for the factory
    function processCompletedProduction(Role role) private {
        require(role == Role.FACTORY, "Only factory has production");
        
        SupplyChainMember storage factory = supplyChainMembers[role];
        uint256 completedProduction = factory.productionPipeline[0];
        
        if (completedProduction > 0) {
            // Update for tracking
            factory.incomingShipment += completedProduction;
            
            // First apply production to backlog if any exists
            uint256 remainingProduction = completedProduction;
            
            if (factory.backorderedAmount > 0) {
                uint256 toFill = factory.backorderedAmount <= remainingProduction ? 
                                factory.backorderedAmount : remainingProduction;
                
                if (toFill > 0) {
                    // Clear backlog first
                    factory.backorderedAmount -= toFill;
                    remainingProduction -= toFill;
                    
                    // Ship the fulfilled backorders
                    shipProduct(Role.FACTORY, Role.DISTRIBUTOR, toFill);
                    // Update outgoing shipment for tracking
                    factory.outgoingShipment += toFill;
                }
            }
            
            // Any remaining production goes to inventory
            if (remainingProduction > 0) {
                factory.currentInventory += remainingProduction;
            }
        }
    }
    
    // Process incoming orders
    function processIncomingOrders(Role role) private {
        SupplyChainMember storage member = supplyChainMembers[role];
        uint256 incomingOrder = member.orderPipeline[0];
        
        if (incomingOrder > 0) {
            // Update for display
            member.incomingOrder = incomingOrder;
            
            // Determine how much we can fulfill from inventory
            uint256 toShip = incomingOrder <= member.currentInventory ? 
                            incomingOrder : member.currentInventory;
            
            // Adjust inventory and backlog
            if (toShip > 0) {
                member.currentInventory -= toShip;
            }
            
            // Track any unfulfilled amount as backlog
            uint256 unfulfilled = incomingOrder - toShip;
            if (unfulfilled > 0) {
                member.backorderedAmount += unfulfilled;
            }
            
            // Ship what we could fulfill
            if (role != Role.RETAILER && toShip > 0) {
                shipProduct(role, Role(uint(role) - 1), toShip);
            }
            
            // Update for tracking
            member.outgoingShipment = toShip;
        }
    }
    
    // Process customer demand to retailer
    function processCustomerDemand(uint256 demand) private {
        if (demand > 0) {
            SupplyChainMember storage retailer = supplyChainMembers[Role.RETAILER];
            
            // Update for display
            retailer.incomingOrder = demand;
            
            // Determine how much we can fulfill from inventory
            uint256 toShip = demand <= retailer.currentInventory ? 
                           demand : retailer.currentInventory;
            
            // Adjust inventory
            if (toShip > 0) {
                retailer.currentInventory -= toShip;
            }
            
            // Track any unfulfilled amount as backlog
            uint256 unfulfilled = demand - toShip;
            if (unfulfilled > 0) {
                retailer.backorderedAmount += unfulfilled;
            }
            
            // Update for tracking
            retailer.outgoingShipment = toShip;
        }
    }
    
    // Ship product from one member to another
    function shipProduct(Role from, Role to, uint256 amount) private {
        if (amount > 0) {
            // Add the shipment to the recipient's pipeline
            supplyChainMembers[to].shipmentPipeline[shippingDelayPeriod] += amount;
            emit ShipmentMade(from, to, amount, currentWeek);
        }
    }
    
    // Update costs for a member
    function updateCosts(Role role) private {
        SupplyChainMember storage member = supplyChainMembers[role];
        
        // Use the same calculation as in calculatePeriodCost
        (uint256 totalPeriodCost, , ) = calculatePeriodCost(role);
        
        // Add this period's cost to the total
        member.totalCost += totalPeriodCost;
    }
    
    // Advance pipelines for a member
    function advancePipelines(Role role) private {
        SupplyChainMember storage member = supplyChainMembers[role];
        
        // Advance order pipeline
        for (uint i = 0; i < member.orderPipeline.length - 1; i++) {
            member.orderPipeline[i] = member.orderPipeline[i + 1];
        }
        member.orderPipeline[member.orderPipeline.length - 1] = 0;
        
        // Advance shipment pipeline - ensuring correct tracking of onOrder values
        for (uint i = 0; i < member.shipmentPipeline.length - 1; i++) {
            member.shipmentPipeline[i] = member.shipmentPipeline[i + 1];
        }
        member.shipmentPipeline[member.shipmentPipeline.length - 1] = 0;
        
        // Advance production pipeline (for factory only)
        if (role == Role.FACTORY) {
            for (uint i = 0; i < member.productionPipeline.length - 1; i++) {
                member.productionPipeline[i] = member.productionPipeline[i + 1];
            }
            member.productionPipeline[member.productionPipeline.length - 1] = 0;
        }
        
        // Reset the incomingOrder and incomingShipment for the next week
        member.incomingOrder = 0;
        member.incomingShipment = 0;
        member.outgoingShipment = 0;  // Also reset outgoingShipment for consistency
    }
    
    // Calculate the total cost across the supply chain
    function getTotalSupplyChainCost() public view returns (uint256) {
        uint256 totalCost = 0;
        
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            totalCost += supplyChainMembers[Role(i)].totalCost;
        }
        
        return totalCost;
    }
    
    // Get player's role or revert if not found
    function getPlayerRole(address player) public view returns (Role) {
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            if (supplyChainMembers[Role(i)].player == player) {
                return Role(i);
            }
        }
        revert("Player not found");
    }
    
    // View functions to get supply chain data (enhancing transparency)
    
    // Get a member's current data
    function getMemberData(Role role) external view returns (
        uint256 inventory, 
        uint256 backorders, 
        uint256 incomingOrder,
        uint256 outgoingOrder,
        uint256 incomingShipment,
        uint256 outgoingShipment,
        uint256 totalCost
    ) {
        SupplyChainMember storage member = supplyChainMembers[role];
        return (
            member.currentInventory,
            member.backorderedAmount,
            member.incomingOrder,
            member.outgoingOrder,
            member.incomingShipment,
            member.outgoingShipment,
            member.totalCost
        );
    }
    
    // Get a member's order pipeline
    function getOrderPipeline(Role role) external view returns (uint256[] memory) {
        return supplyChainMembers[role].orderPipeline;
    }
    
    // Get a member's shipment pipeline
    function getShipmentPipeline(Role role) external view returns (uint256[] memory) {
        return supplyChainMembers[role].shipmentPipeline;
    }
    
    // Get factory's production pipeline
    function getProductionPipeline() external view returns (uint256[] memory) {
        return supplyChainMembers[Role.FACTORY].productionPipeline;
    }
    
    // Get all customer demand values
    function getCustomerDemand() external view returns (uint256[] memory) {
        return customerDemand;
    }

    // Get customer demand for the current week
    function getCurrentCustomerDemand() external view returns (uint256) {
        require(customerDemand.length > 0, "No customer demand data available");
        require(currentWeek < customerDemand.length, "Current week exceeds demand data");
        return customerDemand[currentWeek];
    }

    // Get a member's order for a specific week
    function getMemberOrderForWeek(Role role, uint256 week) external view returns (uint256) {
        return weeklyOrders[role][week];
    }

    // Get factory's production for a specific week
    function getMemberProductionForWeek(uint256 week) external view returns (uint256) {
        return weeklyProduction[week];
    }

    // Get player address for a given role
    function getPlayerAddress(Role role) external view returns (address) {
        return supplyChainMembers[role].player;
    }

    // Take a snapshot of the current state for a member
    function takeStateSnapshot(Role role, Phase phase) private {
        SupplyChainMember storage member = supplyChainMembers[role];
        
        // Calculate onOrder as the sum of the shipment pipeline
        uint256 calculatedOnOrder = 0;
        for (uint i = 0; i < member.shipmentPipeline.length; i++) {
            calculatedOnOrder += member.shipmentPipeline[i];
        }
        
        // Calculate costs for this snapshot
        (uint256 totalCost, uint256 holdingCostValue, uint256 backlogCostValue) = calculatePeriodCost(role);
        
        // Create and store the snapshot
        StateSnapshot memory snapshot = StateSnapshot({
            inventory: member.currentInventory,
            backlog: member.backorderedAmount,
            onOrder: calculatedOnOrder, // Use the calculated sum instead of the stored value
            incomingOrder: member.incomingOrder,
            outgoingOrder: member.outgoingOrder,
            incomingShipment: member.incomingShipment,
            outgoingShipment: member.outgoingShipment,
            weeklyCost: totalCost, // Total cost
            holdingCost: holdingCostValue, // Holding cost component
            backlogCost: backlogCostValue, // Backlog cost component
            phase: phase
        });
        
        // Store the snapshot
        stateSnapshots[role][currentWeek][phase] = snapshot;
        
        // Emit event for external systems
        emit StateSnapshotTaken(role, currentWeek, phase);
    }
    
    // Calculate period cost without updating member totalCost
    function calculatePeriodCost(Role role) private view returns (uint256, uint256, uint256) {
        SupplyChainMember storage member = supplyChainMembers[role];
        uint256 holdingCostValue = 0;
        uint256 backlogCostValue = 0;
        
        // Holding cost for positive inventory
        if (member.currentInventory > 0) {
            holdingCostValue = member.currentInventory * holdingCost;
        }
        
        // Backorder cost
        if (member.backorderedAmount > 0) {
            backlogCostValue = member.backorderedAmount * backorderCost;
        }
        
        // Total period cost
        uint256 periodCost = holdingCostValue + backlogCostValue;
        
        return (periodCost, holdingCostValue, backlogCostValue);
    }

    // Get a member's state snapshot for a specific week and phase
    function getStateSnapshot(Role role, uint256 week, Phase phase) external view returns (
        uint256 inventory,
        uint256 backlog,
        uint256 onOrder,
        uint256 incomingOrder,
        uint256 outgoingOrder,
        uint256 incomingShipment,
        uint256 outgoingShipment,
        uint256 weeklyCost,
        uint256 holdingCostComponent,
        uint256 backlogCostComponent,
        Phase snapshotPhase
    ) {
        StateSnapshot storage snapshot = stateSnapshots[role][week][phase];
        return (
            snapshot.inventory,
            snapshot.backlog,
            snapshot.onOrder,
            snapshot.incomingOrder,
            snapshot.outgoingOrder,
            snapshot.incomingShipment,
            snapshot.outgoingShipment,
            snapshot.weeklyCost,
            snapshot.holdingCost,
            snapshot.backlogCost,
            snapshot.phase
        );
    }
    
    // Helper function to check if a state snapshot exists
    function hasStateSnapshot(Role role, uint256 week, Phase phase) external view returns (bool) {
        // A snapshot exists if the phase value is set (0=WEEK_START, 1=AFTER_SHIPMENTS, etc.)
        // Check inventory as a proxy for whether the snapshot was taken
        return stateSnapshots[role][week][phase].inventory > 0 || 
               stateSnapshots[role][week][phase].backlog > 0 ||
               stateSnapshots[role][week][phase].phase == phase;
    }
    
    // Get complete state snapshots for a week
    function getWeekStateSnapshots(Role role, uint256 week) external view returns (
        StateSnapshot memory weekStart,
        StateSnapshot memory afterShipments,
        StateSnapshot memory afterOrders,
        StateSnapshot memory weekEnd
    ) {
        return (
            stateSnapshots[role][week][Phase.WEEK_START],
            stateSnapshots[role][week][Phase.AFTER_SHIPMENTS],
            stateSnapshots[role][week][Phase.AFTER_ORDERS],
            stateSnapshots[role][week][Phase.WEEK_END]
        );
    }

    // Get detailed cost breakdown for a member
    function getMemberCostBreakdown(Role role, uint256 week) external view returns (
        uint256 totalCumulativeCost,
        uint256 weeklyHoldingCost,
        uint256 weeklyBacklogCost,
        uint256 weeklyTotalCost
    ) {
        SupplyChainMember storage member = supplyChainMembers[role];
        StateSnapshot storage endSnapshot = stateSnapshots[role][week][Phase.WEEK_END];
        
        return (
            member.totalCost,
            endSnapshot.holdingCost,
            endSnapshot.backlogCost,
            endSnapshot.weeklyCost
        );
    }
    
    // Get total cost breakdown for the entire supply chain
    function getTotalCostBreakdown(uint256 week) external view returns (
        uint256 totalCumulativeCost,
        uint256 weeklyHoldingCost,
        uint256 weeklyBacklogCost,
        uint256 weeklyTotalCost
    ) {
        uint256 totalCost = 0;
        uint256 holdingCostSum = 0;
        uint256 backlogCost = 0;
        uint256 weeklyCost = 0;
        
        for (uint i = 0; i <= uint(Role.FACTORY); i++) {
            totalCost += supplyChainMembers[Role(i)].totalCost;
            
            // Get costs from the end state of the week
            StateSnapshot storage endSnapshot = stateSnapshots[Role(i)][week][Phase.WEEK_END];
            holdingCostSum += endSnapshot.holdingCost;
            backlogCost += endSnapshot.backlogCost;
            weeklyCost += endSnapshot.weeklyCost;
        }
        
        return (totalCost, holdingCostSum, backlogCost, weeklyCost);
    }
} 