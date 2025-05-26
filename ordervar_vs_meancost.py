# Load the corrected CSV and preview the data
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

df_new = pd.read_csv('Bullwhip_Metrics_2025-05-08 (1).csv')
print('Preview of the corrected data:')
print(df_new.head())

# Scatter plot: Order Variability (CV_Orders) vs Mean Total Cost by Mode
plt.figure(figsize=(10, 6))
sns.scatterplot(
    data=df_new,
    x='CV_Orders',
    y='Mean_Total_Cost',
    hue='Mode',
    style='Mode',
    s=100,
    alpha=0.8
)
plt.title('Order Variability (CV_Orders) vs Mean Total Cost by Mode')
plt.xlabel('Order Variability (CV_Orders)')
plt.ylabel('Mean Total Cost')
plt.grid(True, linestyle='--', alpha=0.5)
plt.tight_layout()
plt.show()

# Calculate correlation for each mode
corr_trad_cv = traditional_new['CV_Orders'].corr(traditional_new['Mean_Total_Cost'])
corr_block_cv = blockchain_new['CV_Orders'].corr(blockchain_new['Mean_Total_Cost'])

print('Correlation (Traditional):', corr_trad_cv)
print('Correlation (Blockchain):', corr_block_cv)