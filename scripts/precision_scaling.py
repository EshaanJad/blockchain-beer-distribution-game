#!/usr/bin/env python3
"""
Precision Scaling for Beer Distribution Game

This script implements a high-precision scaling method to preserve 
the Coefficient of Variation (CV) of the original Footlocker data
within 1% error margin when converting to integer values.
"""

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from pathlib import Path

def calculate_cv(data):
    """Calculate coefficient of variation (standard deviation / mean)"""
    return np.std(data) / np.mean(data)

def optimize_scaling(original_data, target_mean=6.0, target_cv_error=0.01, 
                    min_scale=1.0, max_scale=100.0, step=0.01, verbose=True):
    """
    Find optimal scaling factor to preserve CV within target error percentage
    while achieving desired mean.
    
    Args:
        original_data: Original data array
        target_mean: Target mean for scaled data
        target_cv_error: Maximum acceptable CV error as a percentage (0.01 = 1%)
        min_scale/max_scale: Range to search for optimal scaling
        step: Step size for scaling factor adjustment
        verbose: Whether to print progress
        
    Returns:
        tuple of (optimal_scaling_factor, optimal_rounded_data)
    """
    original_cv = calculate_cv(original_data)
    original_mean = np.mean(original_data)
    
    # Base scaling factor to achieve target mean
    base_scale = target_mean / original_mean
    
    if verbose:
        print(f"Original CV: {original_cv:.6f}")
        print(f"Target mean: {target_mean:.2f}")
        print(f"Base scaling for target mean: {base_scale:.6f}")
        print("\nSearching for optimal CV-preserving factor...")
    
    best_error = float('inf')
    best_scale = base_scale
    best_data = None
    
    # Try different scaling factors around the base scale
    scales_tried = 0
    
    for scale_multiplier in np.arange(min_scale, max_scale, step):
        scales_tried += 1
        
        # Apply scaling and rounding
        scale_factor = base_scale * scale_multiplier
        scaled_data = original_data * scale_factor
        rounded_data = np.round(scaled_data).astype(int)
        
        # Check how well we preserved CV
        rounded_cv = calculate_cv(rounded_data)
        cv_error = abs(rounded_cv - original_cv) / original_cv
        
        # Check if this is better than our previous best
        if cv_error < best_error:
            best_error = cv_error
            best_scale = scale_factor
            best_data = rounded_data
            
            if verbose and scales_tried % 10 == 0:
                print(f"New best - Scale: {best_scale:.6f}, CV: {rounded_cv:.6f}, Error: {cv_error:.6%}")
            
            # If we're within our target error, we can stop
            if cv_error <= target_cv_error:
                if verbose:
                    print(f"\nFound solution within target error ({cv_error:.6%} ≤ {target_cv_error:.6%})")
                break
    
    if verbose:
        print(f"\nOptimal scaling factor: {best_scale:.6f}")
        print(f"Scales explored: {scales_tried}")
        print(f"Final CV error: {best_error:.6%}")
        print(f"Mean of optimized data: {np.mean(best_data):.4f}")
        print(f"Range: {np.min(best_data)} to {np.max(best_data)}")
        
    return best_scale, best_data

def main():
    # Input and output paths
    script_dir = Path(__file__).parent.parent
    input_file = script_dir / 'scaled_footlocker_data.csv'
    output_file = script_dir / 'precision_scaled_data.csv'
    
    # Load data
    print(f"Loading data from {input_file}")
    df = pd.read_csv(input_file)
    
    # Use the FL US Equity column (original data)
    original_values = df['FL US Equity'].values
    
    # Analyze original data
    original_mean = np.mean(original_values)
    original_std = np.std(original_values)
    original_cv = calculate_cv(original_values)
    
    print(f"\nOriginal data statistics:")
    print(f"- Mean: {original_mean:.4f}")
    print(f"- Standard Deviation: {original_std:.4f}")
    print(f"- Coefficient of Variation: {original_cv:.6f}")
    
    # Find optimal scaling factor
    optimal_scale, optimal_data = optimize_scaling(
        original_values,
        target_mean=6.0,
        target_cv_error=0.01,  # 1% error tolerance
        min_scale=1.0,
        max_scale=20.0,
        step=0.005
    )
    
    # Calculate exact scaled values (without rounding)
    exact_scaled = original_values * optimal_scale
    
    # Calculate statistics for both exact and rounded data
    scaled_cv = calculate_cv(exact_scaled)
    rounded_cv = calculate_cv(optimal_data)
    
    cv_error_exact = abs(scaled_cv - original_cv) / original_cv
    cv_error_rounded = abs(rounded_cv - original_cv) / original_cv
    
    print(f"\nFinal Statistics:")
    print(f"- Exact Scaled CV: {scaled_cv:.6f} (Error: {cv_error_exact:.6%})")
    print(f"- Rounded CV: {rounded_cv:.6f} (Error: {cv_error_rounded:.6%})")
    
    # Update the dataframe with new values
    df['Precision Scaled (Exact)'] = exact_scaled
    df['Precision Scaled (Integer)'] = optimal_data
    
    # Save to CSV
    df.to_csv(output_file, index=False)
    print(f"\nPrecision-scaled data saved to {output_file}")
    
    # Generate value distribution histogram
    plt.figure(figsize=(14, 10))
    
    # Plot 1: Original vs. Scaled Values
    plt.subplot(3, 1, 1)
    plt.plot(original_values, label=f'Original (CV={original_cv:.4f})')
    plt.plot(exact_scaled, label=f'Precision Scaled (CV={scaled_cv:.4f})', 
             linestyle='--', alpha=0.7)
    plt.title(f'Original vs. Scaled Values')
    plt.grid(True)
    plt.legend()
    
    # Plot 2: Integer Values
    plt.subplot(3, 1, 2)
    plt.plot(optimal_data, 'g-o', label=f'Integer Values (CV={rounded_cv:.4f}, Error={cv_error_rounded:.2%})')
    plt.title(f'Precision-Scaled Integer Values (Mean={np.mean(optimal_data):.2f})')
    plt.grid(True)
    plt.legend()
    
    # Plot 3: Value Distribution
    plt.subplot(3, 1, 3)
    unique_values = sorted(np.unique(optimal_data))
    counts = [np.sum(optimal_data == val) for val in unique_values]
    percentages = [count/len(optimal_data)*100 for count in counts]
    
    plt.bar(unique_values, percentages)
    for i, v in enumerate(percentages):
        plt.text(unique_values[i], v+0.5, f'{v:.1f}%', ha='center')
    
    plt.xlabel('Integer Value')
    plt.ylabel('Percentage')
    plt.title('Distribution of Integer Values')
    plt.xticks(unique_values)
    plt.grid(axis='y')
    
    # Adjust layout and save
    plt.tight_layout()
    plot_file = script_dir / 'precision_scaled_plot.png'
    plt.savefig(plot_file)
    print(f"Visualization saved to {plot_file}")
    
    # Print value distribution as text
    print("\nValue Distribution:")
    for value in unique_values:
        count = np.sum(optimal_data == value)
        percentage = count / len(optimal_data) * 100
        print(f"- Value {value}: {count} occurrences ({percentage:.1f}%)")

if __name__ == "__main__":
    main() 