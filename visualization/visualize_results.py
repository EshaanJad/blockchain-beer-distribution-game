#!/usr/bin/env python3
import json
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import os

# Set up the figure style
plt.style.use('ggplot')
SMALL_SIZE = 10
MEDIUM_SIZE = 12
BIGGER_SIZE = 14

plt.rc('font', size=SMALL_SIZE)          # controls default text sizes
plt.rc('axes', titlesize=MEDIUM_SIZE)     # fontsize of the axes title
plt.rc('axes', labelsize=MEDIUM_SIZE)     # fontsize of the x and y labels
plt.rc('xtick', labelsize=SMALL_SIZE)    # fontsize of the tick labels
plt.rc('ytick', labelsize=SMALL_SIZE)    # fontsize of the tick labels
plt.rc('legend', fontsize=SMALL_SIZE)    # legend fontsize
plt.rc('figure', titlesize=BIGGER_SIZE)  # fontsize of the figure title

# Path to the JSON files
periods = 23  # Set the number of periods to analyze
traditional_data_path = f'data_traditional_crocs_{periods}_periods.json'
blockchain_data_path = f'data_blockchain_crocs_{periods}_periods.json'

# Load the simulation data
with open(traditional_data_path, 'r') as f:
    traditional_data = json.load(f)

with open(blockchain_data_path, 'r') as f:
    blockchain_data = json.load(f)

# Function to extract specific metrics from the raw data
def extract_metrics(data):
    # Initialize arrays
    weeks = list(range(len(data["customer"])))
    customer_demand = [entry.get("demand", 0) for entry in data["customer"]]
    
    # Extract member data (each role is an array of weeks)
    roles = ["retailer", "wholesaler", "distributor", "factory"]
    role_data = {role: data.get(role, []) for role in roles}
    
    # Initialize metrics dictionaries
    metrics = {
        'weeks': weeks,
        'customer_demand': customer_demand
    }
    
    # Extract data for each role
    for role in roles:
        if role not in data:
            continue
            
        role_entries = data[role]
        
        # Orders/Production
        metrics[f'{role}_orders'] = [entry.get("order", 0) for entry in role_entries]
        
        # Inventory
        metrics[f'{role}_inventory'] = [entry.get("onHand", 0) for entry in role_entries]
        
        # Backlog
        metrics[f'{role}_backlog'] = [entry.get("backlog", 0) for entry in role_entries]
        
        # Weekly Cost (instead of just 'cost')
        metrics[f'{role}_cost'] = [entry.get("weeklyCost", 0) for entry in role_entries]
        
        # Total cumulative cost
        metrics[f'{role}_total_cost'] = [entry.get("totalCost", 0) for entry in role_entries]
    
    # Calculate total weekly cost across all roles
    metrics['total_weekly_cost'] = []
    for i in range(len(weeks)):
        week_cost = 0
        for role in roles:
            role_costs = metrics.get(f'{role}_cost', [])
            if i < len(role_costs):
                week_cost += role_costs[i]
        metrics['total_weekly_cost'].append(week_cost)
    
    # Get the final cumulative cost at the last week for each role
    final_total_cost = 0
    for role in roles:
        total_cost_list = metrics.get(f'{role}_total_cost', [])
        if total_cost_list:
            final_total_cost += total_cost_list[-1]
    
    metrics['final_total_cost'] = final_total_cost
    
    return metrics

# Extract metrics
traditional_metrics = extract_metrics(traditional_data)
blockchain_metrics = extract_metrics(blockchain_data)

# Create plots directory if it doesn't exist
if not os.path.exists('plots'):
    os.makedirs('plots')

# 1. Plot Customer Demand
plt.figure(figsize=(10, 6))
plt.plot(traditional_metrics['weeks'], traditional_metrics['customer_demand'], marker='o', linestyle='-', label='Customer Demand')
plt.title('Customer Demand Pattern')
plt.xlabel('Week')
plt.ylabel('Demand (units)')
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.savefig('plots/customer_demand.png', dpi=300)
plt.close()

# 2. Plot Order Quantities - Comparison between Traditional and Blockchain
roles = ['retailer', 'wholesaler', 'distributor', 'factory']
role_display_names = ['Retailer', 'Wholesaler', 'Distributor', 'Factory']

plt.figure(figsize=(14, 10))
for i, role in enumerate(roles):
    plt.subplot(2, 2, i+1)
    plt.plot(traditional_metrics['weeks'], traditional_metrics[f'{role}_orders'], marker='o', linestyle='-', color='blue', label=f'Traditional')
    plt.plot(blockchain_metrics['weeks'], blockchain_metrics[f'{role}_orders'], marker='x', linestyle='--', color='green', label=f'Blockchain')
    plt.plot(traditional_metrics['weeks'], traditional_metrics['customer_demand'], linestyle=':', color='gray', label='Customer Demand')
    plt.title(f'{role_display_names[i]} Order Quantity')
    plt.xlabel('Week')
    plt.ylabel('Order Quantity (units)')
    plt.grid(True)
    plt.legend()
plt.tight_layout()
plt.savefig('plots/order_comparison.png', dpi=300)
plt.close()

# 3. Plot Inventory Levels - Comparison
plt.figure(figsize=(14, 10))
for i, role in enumerate(roles):
    plt.subplot(2, 2, i+1)
    plt.plot(traditional_metrics['weeks'], traditional_metrics[f'{role}_inventory'], marker='o', linestyle='-', color='blue', label=f'Traditional')
    plt.plot(blockchain_metrics['weeks'], blockchain_metrics[f'{role}_inventory'], marker='x', linestyle='--', color='green', label=f'Blockchain')
    plt.title(f'{role_display_names[i]} Inventory Level')
    plt.xlabel('Week')
    plt.ylabel('Inventory (units)')
    plt.grid(True)
    plt.legend()
plt.tight_layout()
plt.savefig('plots/inventory_comparison.png', dpi=300)
plt.close()

# 4. Plot Backlog Levels - Comparison
plt.figure(figsize=(14, 10))
for i, role in enumerate(roles):
    plt.subplot(2, 2, i+1)
    plt.plot(traditional_metrics['weeks'], traditional_metrics[f'{role}_backlog'], marker='o', linestyle='-', color='blue', label=f'Traditional')
    plt.plot(blockchain_metrics['weeks'], blockchain_metrics[f'{role}_backlog'], marker='x', linestyle='--', color='green', label=f'Blockchain')
    plt.title(f'{role_display_names[i]} Backlog')
    plt.xlabel('Week')
    plt.ylabel('Backlog (units)')
    plt.grid(True)
    plt.legend()
plt.tight_layout()
plt.savefig('plots/backlog_comparison.png', dpi=300)
plt.close()

# 5. Plot Costs - Individual roles
plt.figure(figsize=(14, 10))
for i, role in enumerate(roles):
    plt.subplot(2, 2, i+1)
    plt.plot(traditional_metrics['weeks'], traditional_metrics[f'{role}_cost'], marker='o', linestyle='-', color='blue', label=f'Traditional')
    plt.plot(blockchain_metrics['weeks'], blockchain_metrics[f'{role}_cost'], marker='x', linestyle='--', color='green', label=f'Blockchain')
    plt.title(f'{role_display_names[i]} Weekly Costs')
    plt.xlabel('Week')
    plt.ylabel('Weekly Cost')
    plt.grid(True)
    plt.legend()
plt.tight_layout()
plt.savefig('plots/cost_by_role.png', dpi=300)
plt.close()

# 6. Plot Cumulative Costs - Comparison
plt.figure(figsize=(14, 10))
for i, role in enumerate(roles):
    plt.subplot(2, 2, i+1)
    plt.plot(traditional_metrics['weeks'], traditional_metrics[f'{role}_total_cost'], marker='o', linestyle='-', color='blue', label=f'Traditional')
    plt.plot(blockchain_metrics['weeks'], blockchain_metrics[f'{role}_total_cost'], marker='x', linestyle='--', color='green', label=f'Blockchain')
    plt.title(f'{role_display_names[i]} Cumulative Costs')
    plt.xlabel('Week')
    plt.ylabel('Cumulative Cost')
    plt.grid(True)
    plt.legend()
plt.tight_layout()
plt.savefig('plots/cumulative_cost_by_role.png', dpi=300)
plt.close()

# 7. Plot Total Cumulative Costs - Comparison
# Use total cost for each role at each week
trad_cum_costs = []
blockchain_cum_costs = []

for week in traditional_metrics['weeks']:
    if week >= len(traditional_metrics['weeks']):
        continue
        
    # Sum the total costs across all roles for this week
    trad_week_total = 0
    blockchain_week_total = 0
    
    for role in roles:
        if week < len(traditional_metrics.get(f'{role}_total_cost', [])):
            trad_week_total += traditional_metrics[f'{role}_total_cost'][week]
        if week < len(blockchain_metrics.get(f'{role}_total_cost', [])):
            blockchain_week_total += blockchain_metrics[f'{role}_total_cost'][week]
    
    trad_cum_costs.append(trad_week_total)
    blockchain_cum_costs.append(blockchain_week_total)

plt.figure(figsize=(10, 6))
plt.plot(traditional_metrics['weeks'][:len(trad_cum_costs)], trad_cum_costs, marker='o', linestyle='-', color='blue', label='Traditional')
plt.plot(blockchain_metrics['weeks'][:len(blockchain_cum_costs)], blockchain_cum_costs, marker='x', linestyle='--', color='green', label='Blockchain')
plt.title('Total Supply Chain Cumulative Costs')
plt.xlabel('Week')
plt.ylabel('Cumulative Cost')
plt.grid(True)
plt.legend()
plt.tight_layout()
plt.savefig('plots/total_cumulative_costs.png', dpi=300)
plt.close()

# 8. Calculate the Bullwhip Effect Ratio and plot it
def calculate_bullwhip(orders, demand):
    # Calculate coefficient of variation (CV) = standard deviation / mean
    cv_orders = np.std(orders) / np.mean(orders) if np.mean(orders) > 0 else 0
    cv_demand = np.std(demand) / np.mean(demand) if np.mean(demand) > 0 else 0
    # Bullwhip effect is the ratio of CV of orders to CV of demand
    return cv_orders / cv_demand if cv_demand > 0 else 0

# Calculate bullwhip for each role in both scenarios
trad_bullwhip = [
    calculate_bullwhip(traditional_metrics[f'{role}_orders'], traditional_metrics['customer_demand'])
    for role in roles
]

blockchain_bullwhip = [
    calculate_bullwhip(blockchain_metrics[f'{role}_orders'], blockchain_metrics['customer_demand'])
    for role in roles
]

plt.figure(figsize=(10, 6))
x = np.arange(len(roles))
width = 0.35
plt.bar(x - width/2, trad_bullwhip, width, label='Traditional', color='blue')
plt.bar(x + width/2, blockchain_bullwhip, width, label='Blockchain', color='green')
plt.xlabel('Supply Chain Role')
plt.ylabel('Bullwhip Ratio (CV Orders / CV Demand)')
plt.title('Bullwhip Effect Comparison')
plt.xticks(x, role_display_names)
plt.legend()
plt.grid(True, axis='y')
plt.tight_layout()
plt.savefig('plots/bullwhip_effect.png', dpi=300)
plt.close()

# 9. Create summary dataframe with key metrics
trad_final_cost = traditional_metrics['final_total_cost']
blockchain_final_cost = blockchain_metrics['final_total_cost']

summary_data = {
    'Metric': [
        'Total Cost', 
        'Avg Inventory - Retailer', 
        'Avg Inventory - Wholesaler',
        'Avg Inventory - Distributor',
        'Avg Inventory - Factory',
        'Avg Backlog - Retailer',
        'Avg Backlog - Wholesaler',
        'Avg Backlog - Distributor',
        'Avg Backlog - Factory',
        'Bullwhip - Retailer',
        'Bullwhip - Wholesaler',
        'Bullwhip - Distributor',
        'Bullwhip - Factory'
    ],
    'Traditional': [
        trad_final_cost,
        np.mean(traditional_metrics['retailer_inventory']),
        np.mean(traditional_metrics['wholesaler_inventory']),
        np.mean(traditional_metrics['distributor_inventory']),
        np.mean(traditional_metrics['factory_inventory']),
        np.mean(traditional_metrics['retailer_backlog']),
        np.mean(traditional_metrics['wholesaler_backlog']),
        np.mean(traditional_metrics['distributor_backlog']),
        np.mean(traditional_metrics['factory_backlog']),
        trad_bullwhip[0],
        trad_bullwhip[1],
        trad_bullwhip[2],
        trad_bullwhip[3]
    ],
    'Blockchain': [
        blockchain_final_cost,
        np.mean(blockchain_metrics['retailer_inventory']),
        np.mean(blockchain_metrics['wholesaler_inventory']),
        np.mean(blockchain_metrics['distributor_inventory']),
        np.mean(blockchain_metrics['factory_inventory']),
        np.mean(blockchain_metrics['retailer_backlog']),
        np.mean(blockchain_metrics['wholesaler_backlog']),
        np.mean(blockchain_metrics['distributor_backlog']),
        np.mean(blockchain_metrics['factory_backlog']),
        blockchain_bullwhip[0],
        blockchain_bullwhip[1],
        blockchain_bullwhip[2],
        blockchain_bullwhip[3]
    ]
}

# Calculate the difference and percentage
df = pd.DataFrame(summary_data)
df['Difference'] = df['Blockchain'] - df['Traditional']
df['% Change'] = (df['Difference'] / df['Traditional'] * 100).round(2) if trad_final_cost > 0 else 0

# Save to CSV
df.to_csv('plots/summary_metrics.csv', index=False)

# Calculate cost reduction and percentage
cost_reduction = trad_final_cost - blockchain_final_cost
pct_reduction = (cost_reduction / trad_final_cost * 100) if trad_final_cost > 0 else 0

# Print summary
print(f"Visualization complete! Images saved to the 'plots' directory.")
print(f"\nSummary of Key Metrics:")
print(f"Traditional total cost: {trad_final_cost}")
print(f"Blockchain total cost: {blockchain_final_cost}")
print(f"Cost reduction: {cost_reduction}")
print(f"Percentage reduction: {pct_reduction:.2f}%")

# 10. Create HTML report
html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>Beer Distribution Game Simulation Results</title>
    <style>
        body {{ font-family: Arial, sans-serif; margin: 20px; line-height: 1.6; }}
        h1, h2 {{ color: #333; }}
        .container {{ max-width: 1200px; margin: 0 auto; }}
        .summary {{ background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }}
        .image-container {{ margin-bottom: 30px; }}
        img {{ max-width: 100%; border: 1px solid #ddd; border-radius: 5px; }}
        table {{ border-collapse: collapse; width: 100%; margin-bottom: 20px; }}
        th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
        th {{ background-color: #f2f2f2; }}
        tr:nth-child(even) {{ background-color: #f9f9f9; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Beer Distribution Game Simulation Results</h1>
        
        <div class="summary">
            <h2>Summary</h2>
            <p><strong>Traditional Total Cost:</strong> {trad_final_cost}</p>
            <p><strong>Blockchain Total Cost:</strong> {blockchain_final_cost}</p>
            <p><strong>Cost Reduction:</strong> {cost_reduction}</p>
            <p><strong>Percentage Reduction:</strong> {pct_reduction:.2f}%</p>
        </div>
        
        <div class="image-container">
            <h2>Customer Demand</h2>
            <img src="customer_demand.png" alt="Customer Demand Pattern">
        </div>
        
        <div class="image-container">
            <h2>Order Quantity Comparison</h2>
            <p>Comparison of order quantities between traditional and blockchain-enabled supply chain for each role.</p>
            <img src="order_comparison.png" alt="Order Comparison">
        </div>
        
        <div class="image-container">
            <h2>Inventory Level Comparison</h2>
            <p>Comparison of inventory levels between traditional and blockchain-enabled supply chain for each role.</p>
            <img src="inventory_comparison.png" alt="Inventory Comparison">
        </div>
        
        <div class="image-container">
            <h2>Backlog Comparison</h2>
            <p>Comparison of backlog levels between traditional and blockchain-enabled supply chain for each role.</p>
            <img src="backlog_comparison.png" alt="Backlog Comparison">
        </div>
        
        <div class="image-container">
            <h2>Weekly Costs by Role</h2>
            <p>Comparison of weekly costs between traditional and blockchain-enabled supply chain for each role.</p>
            <img src="cost_by_role.png" alt="Weekly Cost by Role">
        </div>
        
        <div class="image-container">
            <h2>Cumulative Costs by Role</h2>
            <p>Comparison of cumulative costs between traditional and blockchain-enabled supply chain for each role.</p>
            <img src="cumulative_cost_by_role.png" alt="Cumulative Cost by Role">
        </div>
        
        <div class="image-container">
            <h2>Total Cumulative Costs</h2>
            <p>Comparison of total cumulative costs between traditional and blockchain-enabled supply chain.</p>
            <img src="total_cumulative_costs.png" alt="Total Cumulative Costs">
        </div>
        
        <div class="image-container">
            <h2>Bullwhip Effect</h2>
            <p>Comparison of the bullwhip effect between traditional and blockchain-enabled supply chain.</p>
            <img src="bullwhip_effect.png" alt="Bullwhip Effect">
        </div>
    </div>
</body>
</html>
"""

with open('plots/simulation_report.html', 'w') as f:
    f.write(html_content)

print(f"HTML report generated at plots/simulation_report.html") 