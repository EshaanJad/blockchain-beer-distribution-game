/**
 * Scale Footlocker Data for Beer Distribution Game
 * 
 * This script scales the Footlocker to Crocs order value data using linear scaling
 * based on mean, with a target BDG mean demand of 6 units per period.
 * Values are rounded to the nearest integer while preserving relative variability.
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Target mean for BDG simulation
const TARGET_MEAN_BDG = 6;

// Paths for input and output files
const inputFile = path.join(__dirname, '..', 'footlocker_to_crocs_order_value.csv');
const outputFile = path.join(__dirname, '..', 'scaled_footlocker_data.csv');

// Array to store the data
const data = [];

// Helper function to calculate standard deviation
function calculateStdDev(values, mean) {
  const squaredDiffs = values.map(value => Math.pow(value - mean, 2));
  const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / values.length;
  return Math.sqrt(variance);
}

// Read the CSV file
fs.createReadStream(inputFile)
  .pipe(csv())
  .on('data', (row) => {
    // Convert the FL US Equity value to a number
    const flValue = parseFloat(row['FL US Equity']);
    if (!isNaN(flValue)) {
      data.push({
        Period: row.Period,
        Quarter: row.Quarter,
        'FL US Equity': flValue,
      });
    }
  })
  .on('end', () => {
    // Calculate the mean of the FL US Equity values
    const sum = data.reduce((acc, row) => acc + row['FL US Equity'], 0);
    const meanFlValue = sum / data.length;
    
    // Calculate standard deviation of original data
    const originalValues = data.map(row => row['FL US Equity']);
    const originalStdDev = calculateStdDev(originalValues, meanFlValue);
    const originalCV = originalStdDev / meanFlValue;
    
    console.log(`Original data summary:`);
    console.log(`- Number of records: ${data.length}`);
    console.log(`- Mean FL US Equity: ${meanFlValue.toFixed(4)}`);
    console.log(`- Standard Deviation: ${originalStdDev.toFixed(4)}`);
    console.log(`- Coefficient of Variation: ${originalCV.toFixed(4)}`);
    
    // Calculate the scaling factor
    const scalingFactor = meanFlValue / TARGET_MEAN_BDG;
    console.log(`Scaling factor: ${scalingFactor.toFixed(4)}`);
    
    // Scale the data and round to the nearest integer
    const scaledData = data.map(row => {
      const scaledExact = row['FL US Equity'] / scalingFactor;
      const scaledRounded = Math.round(scaledExact);
      
      return {
        Period: row.Period,
        Quarter: row.Quarter,
        'FL US Equity': row['FL US Equity'],
        'Scaled Value (Exact)': parseFloat(scaledExact.toFixed(4)),
        'Scaled Value': scaledRounded
      };
    });
    
    // Calculate statistics for the exact scaled data (before rounding)
    const exactScaledValues = scaledData.map(row => row['Scaled Value (Exact)']);
    const exactScaledSum = exactScaledValues.reduce((acc, val) => acc + val, 0);
    const exactScaledMean = exactScaledSum / exactScaledValues.length;
    const exactScaledStdDev = calculateStdDev(exactScaledValues, exactScaledMean);
    const exactScaledCV = exactScaledStdDev / exactScaledMean;
    
    // Calculate statistics for the rounded scaled data
    const roundedScaledValues = scaledData.map(row => row['Scaled Value']);
    const roundedScaledSum = roundedScaledValues.reduce((acc, val) => acc + val, 0);
    const roundedScaledMean = roundedScaledSum / roundedScaledValues.length;
    const roundedScaledStdDev = calculateStdDev(roundedScaledValues, roundedScaledMean);
    const roundedScaledCV = roundedScaledStdDev / roundedScaledMean;
    
    const minScaled = Math.min(...roundedScaledValues);
    const maxScaled = Math.max(...roundedScaledValues);
    
    console.log(`\nExact scaled data (before rounding):`);
    console.log(`- Mean: ${exactScaledMean.toFixed(4)} (target: ${TARGET_MEAN_BDG})`);
    console.log(`- Standard Deviation: ${exactScaledStdDev.toFixed(4)}`);
    console.log(`- Coefficient of Variation: ${exactScaledCV.toFixed(4)}`);
    
    console.log(`\nRounded scaled data summary:`);
    console.log(`- Mean: ${roundedScaledMean.toFixed(4)} (target: ${TARGET_MEAN_BDG})`);
    console.log(`- Standard Deviation: ${roundedScaledStdDev.toFixed(4)}`);
    console.log(`- Coefficient of Variation: ${roundedScaledCV.toFixed(4)}`);
    console.log(`- Min: ${minScaled}`);
    console.log(`- Max: ${maxScaled}`);
    console.log(`- Range: ${maxScaled - minScaled}`);
    
    // Display CV comparison to verify preservation
    console.log(`\nCoefficient of Variation Comparison:`);
    console.log(`- Original data CV: ${originalCV.toFixed(4)}`);
    console.log(`- Exact scaled data CV: ${exactScaledCV.toFixed(4)}`);
    console.log(`- Rounded scaled data CV: ${roundedScaledCV.toFixed(4)}`);
    console.log(`- CV Preservation (exact): ${(exactScaledCV / originalCV * 100).toFixed(2)}%`);
    console.log(`- CV Preservation (rounded): ${(roundedScaledCV / originalCV * 100).toFixed(2)}%`);
    
    // Create the CSV writer
    const csvWriter = createCsvWriter({
      path: outputFile,
      header: [
        {id: 'Period', title: 'Period'},
        {id: 'Quarter', title: 'Quarter'},
        {id: 'FL US Equity', title: 'FL US Equity'},
        {id: 'Scaled Value (Exact)', title: 'Scaled Value (Exact)'},
        {id: 'Scaled Value', title: 'Scaled Value (Integer)'}
      ]
    });
    
    // Write the scaled data to a new CSV file
    csvWriter.writeRecords(scaledData)
      .then(() => {
        console.log(`\nLinear scaling complete. Integer-rounded data saved to ${outputFile}`);
      });
  });

console.log(`Processing ${inputFile}...`); 