# Load the corrected CSV and preview the data
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

df_new = pd.read_csv('Bullwhip_Metrics_2025-05-08 (1).csv')
print('Preview of the corrected data:')
print(df_new.head())

# Create a boxplot to visualize the distribution of Bullwhip Ratio by Mode
plt.figure(figsize=(8, 6))
sns.boxplot(data=df_new, x='Mode', y='Bullwhip_Ratio', palette='Set2')
sns.stripplot(data=df_new, x='Mode', y='Bullwhip_Ratio', color='black', alpha=0.4, jitter=True)
plt.title('Distribution of Bullwhip Ratio by Mode')
plt.xlabel('Mode')
plt.ylabel('Bullwhip Ratio')
plt.grid(axis='y', linestyle='--', alpha=0.5)
plt.tight_layout()
plt.show()

# Show summary statistics for each mode
summary_stats = df_new.groupby('Mode')['Bullwhip_Ratio'].describe().round(3)
print(summary_stats)