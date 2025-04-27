# Beer Distribution Game Visualizations

This directory contains the visualization tools and components for the Beer Distribution Game simulation. These visualizations help in analyzing simulation results, comparing different ordering policies, and demonstrating the impact of blockchain-enabled visibility on supply chain performance.

## Key Files

### sterman-visualization.html

A dedicated visualization tool for Sterman model simulations with various configurations:

**Key features:**
- Interactive selection of simulation types (standard, two-order delay, two-shipping delay, zero-delay, hybrid models)
- Side-by-side comparison of traditional and blockchain supply chain performance
- Visualization of orders, inventory levels, backlog levels, and costs for each role
- Detailed simulation settings and summary statistics

### chartUtils.js

Utility functions for creating and formatting charts with Chart.js.

**Key features:**
- Color schemes for consistent visualization
- Data transformation helpers
- Chart configuration templates
- Export functionality for publication-quality images

### dashboardComponents.js

Reusable UI components for building interactive dashboards to display simulation results.

**Key features:**
- Role selector components
- Time period sliders
- Metric selection dropdowns
- Visibility mode toggles

### bullwhipVisualizer.js

Specialized visualization tools focused on displaying and quantifying the bullwhip effect.

**Key features:**
- Amplification ratio calculations
- Order variance visualization across roles
- Comparative analysis between traditional and blockchain-enabled scenarios
- Statistical significance testing

## Visualization Types

### Time Series Charts

Used to display how metrics evolve over time periods in the game:
- **Order Quantities**: Shows order patterns for each role
- **Inventory Levels**: Tracks on-hand inventory and backlog
- **Costs**: Accumulates holding and stockout costs

### Comparison Charts

Designed to compare different scenarios:
- **Traditional vs. Blockchain**: Side-by-side comparison of key metrics
- **Policy Comparison**: Compare different ordering policy performance
- **Parameter Sensitivity**: Show impact of different parameter settings

### System Performance Indicators

Aggregate metrics that summarize overall system performance:
- **Total Supply Chain Cost**: Sum of all roles' costs
- **Service Level**: Percentage of orders fulfilled without delay
- **Information Sharing Value**: Quantification of benefits from blockchain visibility

## Interactive Dashboard Features

The visualizations support the following interactive features:

1. **Filtering**: Filter data by:
   - Role (Retailer, Wholesaler, Distributor, Factory)
   - Time periods
   - Demand patterns
   - Visibility mode

2. **Zooming**: Zoom in on specific time periods or events

3. **Tooltip Information**: Detailed information display on hover

4. **Animation**: Step-by-step animation of game progression

5. **Export**: Save charts as PNG/SVG for publication

## Running the Visualization Dashboard

### On macOS/Linux:

1. Start a local web server in this directory:
```bash
python3 -m http.server 8000
```

2. Open a browser and navigate to:
```
http://localhost:8000/visualization.html
```

### On Windows:

1. Start a local web server using one of these options:

   **Using Python**:
   ```powershell
   # Standard Python command (if in path)
   python -m http.server 8000
   
   # Using Python launcher
   py -3 -m http.server 8000
   
   # Using Microsoft Store Python
   python3 -m http.server 8000
   ```

   **Using Node.js http-server** (alternative):
   ```powershell
   # Install globally (if not already installed)
   npm install -g http-server
   
   # Run server
   http-server -p 8000
   ```

   **Using Visual Studio Code**:
   - Install the "Live Server" extension
   - Right-click on visualization.html
   - Select "Open with Live Server"

   **Using PHP** (if installed):
   ```powershell
   php -S localhost:8000
   ```

2. Open a browser and navigate to:
```
http://localhost:8000/visualization.html
```

## Usage Example

```javascript
const { createBullwhipChart } = require('./visualization/bullwhipVisualizer');
const { formatGameResults } = require('./visualization/chartUtils');

// After running a simulation
const formattedResults = formatGameResults(simulationResults);
const chart = createBullwhipChart(
    formattedResults.traditionalResults,
    formattedResults.blockchainResults,
    {
        title: 'Bullwhip Effect Comparison',
        width: 800,
        height: 500,
        includeLegend: true,
        includeStatistics: true
    }
);

// Export chart for publication
chart.exportAsSVG('bullwhip_comparison.svg');
```

## Journal Publication Guidelines

For preparing visualizations for journal publication:

1. **Resolution Requirements**:
   - Minimum 300 DPI for print publication
   - Vector formats (SVG) preferred for line charts

2. **Color Guidelines**:
   - Use colorblind-friendly palettes
   - Ensure sufficient contrast for grayscale printing
   - Limit to 5-7 colors per visualization

3. **Formatting Standards**:
   - Font sizes: minimum 8pt for axis labels, 10pt for titles
   - Error bars required for statistical data
   - Consistent units and scales across related charts

4. **Data Transparency**:
   - Include sample sizes
   - Display statistical significance indicators
   - Provide access to underlying data

## Integration with Reports

The visualization components are designed to integrate with the reporting module for generating comprehensive analysis reports. Use the `reportGenerator.js` to automatically include visualizations in PDF reports.

## Future Enhancements

Planned visualization enhancements include:
- Interactive web-based dashboard
- Real-time visualization during simulation
- 3D supply chain network visualization
- Machine learning-based anomaly highlighting 