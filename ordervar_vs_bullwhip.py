import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np

# Load and pivot the data
df = pd.read_csv('Bullwhip_Metrics_2025-05-08 (1).csv')

# Filter for full participation scenarios first
df_full = df[df['Scenario'].str.contains('Full', na=False)].copy()

# Pivot the data to get Traditional and Blockchain side by side
df_pivot = df_full.pivot_table(
    index=['Scenario', 'Stage'],
    columns='Mode',
    values=['Variance_Orders_Placed', 'Bullwhip_Ratio']
).reset_index()

# Flatten column names
df_pivot.columns = [f"{col[0]}_{col[1]}" if col[1] != "" else col[0] 
                   for col in df_pivot.columns]

# Rename columns for clarity
df_pivot = df_pivot.rename(columns={
    'Variance_Orders_Placed_Traditional': 'Order_Variability_Traditional',
    'Variance_Orders_Placed_Blockchain': 'Order_Variability_Blockchain',
    'Bullwhip_Ratio_Traditional': 'Bullwhip_Ratio_Traditional',
    'Bullwhip_Ratio_Blockchain': 'Bullwhip_Ratio_Blockchain'
})

# Create scatter plot
plt.figure(figsize=(12, 8))

# Plot points
sns.scatterplot(data=df_pivot, 
                x='Order_Variability_Traditional', 
                y='Bullwhip_Ratio_Traditional',
                label='Traditional',
                color='blue',
                alpha=0.6)

sns.scatterplot(data=df_pivot, 
                x='Order_Variability_Blockchain', 
                y='Bullwhip_Ratio_Blockchain',
                label='Blockchain',
                color='red',
                alpha=0.6)

# Add regression lines
sns.regplot(data=df_pivot, 
            x='Order_Variability_Traditional', 
            y='Bullwhip_Ratio_Traditional',
            scatter=False,
            color='blue')

sns.regplot(data=df_pivot, 
            x='Order_Variability_Blockchain', 
            y='Bullwhip_Ratio_Blockchain',
            scatter=False,
            color='red')

plt.title('Order Variability vs Bullwhip Ratio\
(Full Participation Scenarios)')
plt.xlabel('Order Variability')
plt.ylabel('Bullwhip Ratio')

# Calculate correlations
trad_corr = np.corrcoef(df_pivot['Order_Variability_Traditional'], 
                        df_pivot['Bullwhip_Ratio_Traditional'])[0,1]
bc_corr = np.corrcoef(df_pivot['Order_Variability_Blockchain'], 
                      df_pivot['Bullwhip_Ratio_Blockchain'])[0,1]

# Add correlation coefficients to plot
plt.text(0.05, 0.95, f'Traditional Correlation: {trad_corr:.3f}', 
         transform=plt.gca().transAxes, color='blue')
plt.text(0.05, 0.90, f'Blockchain Correlation: {bc_corr:.3f}', 
         transform=plt.gca().transAxes, color='red')

plt.tight_layout()
plt.show()

# Print summary statistics
print("\
Summary Statistics:")
print("\
Traditional System:")
print(df_pivot[['Order_Variability_Traditional', 'Bullwhip_Ratio_Traditional']].describe())
print("\
Blockchain System:")
print(df_pivot[['Order_Variability_Blockchain', 'Bullwhip_Ratio_Blockchain']].describe())