# Load the corrected CSV and preview the data
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

df_new = pd.read_csv('Bullwhip_Metrics_2025-05-08 (1).csv')
print('Preview of the corrected data:')
print(df_new.head())

# Scatter plot: Bullwhip Ratio vs Mean Total Cost by Mode (using corrected data)
plt.figure(figsize=(10, 6))
sns.scatterplot(
    data=df_new,
    x='Bullwhip_Ratio',
    y='Mean_Total_Cost',
    hue='Mode',
    style='Mode',
    s=100,
    alpha=0.8
)
plt.title('Bullwhip Ratio vs Mean Total Cost by Mode (Corrected)')
plt.xlabel('Bullwhip Ratio')
plt.ylabel('Mean Total Cost')
plt.grid(True, linestyle='--', alpha=0.5)
plt.tight_layout()
plt.show()

# Calculate correlation for each mode
traditional_new = df_new[df_new['Mode'] == 'Traditional']
blockchain_new = df_new[df_new['Mode'] == 'Blockchain']

corr_trad_new = traditional_new['Bullwhip_Ratio'].corr(traditional_new['Mean_Total_Cost'])
corr_block_new = blockchain_new['Bullwhip_Ratio'].corr(blockchain_new['Mean_Total_Cost'])

# Find min cost and bullwhip for Blockchain
min_cost_block_new = blockchain_new['Mean_Total_Cost'].min()
min_bullwhip_block_new = blockchain_new['Bullwhip_Ratio'].min()

print('Correlation (Traditional):', corr_trad_new)
print('Correlation (Blockchain):', corr_block_new)
print('Blockchain min cost:', min_cost_block_new)
print('Blockchain min bullwhip:', min_bullwhip_block_new)