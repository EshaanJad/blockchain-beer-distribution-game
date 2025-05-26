import csv
import json
import os

# Input and output paths
csv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../BeerGameResults_Traditional_1-2.csv'))
json_path = os.path.join(os.path.dirname(__file__), 'traditional.json')

def parse_float_or_int(value):
    try:
        if '.' in value:
            return float(value)
        return int(value)
    except Exception:
        return 0

def main():
    data = []
    with open(csv_path, 'r', encoding='utf-8-sig') as csvfile:
        reader = csv.DictReader(csvfile)
        # Strip whitespace from fieldnames
        reader.fieldnames = [fn.strip() for fn in reader.fieldnames]
        for row in reader:
            # Also strip whitespace from keys in each row
            row = {k.strip(): v for k, v in row.items()}
            entry = {
                "week": int(row["Week"]),
                "inventory": [
                    int(row["Retailer_Inventory"]),
                    int(row["Wholesaler_Inventory"]),
                    int(row["Distributor_Inventory"]),
                    int(row["Factory_Inventory"]),
                ],
                "backlog": [
                    int(row["Retailer_Backlog"]),
                    int(row["Wholesaler_Backlog"]),
                    int(row["Distributor_Backlog"]),
                    int(row["Factory_Backlog"]),
                ],
                "orders": [
                    int(row["Retailer_OrdersPlaced"]),
                    int(row["Wholesaler_OrdersPlaced"]),
                    int(row["Distributor_OrdersPlaced"]),
                    int(row["Factory_OrdersPlaced"]),
                ],
                "incoming": [
                    int(row["Retailer_IncomingReceived"]),
                    int(row["Wholesaler_IncomingReceived"]),
                    int(row["Distributor_IncomingReceived"]),
                    int(row["Factory_IncomingReceived"]),
                ],
                "operationalCost": [
                    parse_float_or_int(row["Retailer_WeeklyOpCost"]),
                    parse_float_or_int(row["Wholesaler_WeeklyOpCost"]),
                    parse_float_or_int(row["Distributor_WeeklyOpCost"]),
                    parse_float_or_int(row["Factory_WeeklyOpCost"]),
                ],
                "gas": [
                    parse_float_or_int(row["Retailer_GasCost"]),
                    parse_float_or_int(row["Wholesaler_GasCost"]),
                    parse_float_or_int(row["Distributor_GasCost"]),
                    parse_float_or_int(row["Factory_GasCost"]),
                ],
                "systemGas": parse_float_or_int(row["System_Gas"]),
                "cumulativeCost": [
                    parse_float_or_int(row["Retailer_CumulativeOpCost"]),
                    parse_float_or_int(row["Wholesaler_CumulativeOpCost"]),
                    parse_float_or_int(row["Distributor_CumulativeOpCost"]),
                    parse_float_or_int(row["Factory_CumulativeOpCost"]),
                ],
                "totalGasCost": [
                    parse_float_or_int(row["Retailer_TotalGasCost"]),
                    parse_float_or_int(row["Wholesaler_TotalGasCost"]),
                    parse_float_or_int(row["Distributor_TotalGasCost"]),
                    parse_float_or_int(row["Factory_TotalGasCost"]),
                ],
                "totalCostWithGas": [
                    parse_float_or_int(row["Retailer_TotalCostWithGas"]),
                    parse_float_or_int(row["Wholesaler_TotalCostWithGas"]),
                    parse_float_or_int(row["Distributor_TotalCostWithGas"]),
                    parse_float_or_int(row["Factory_TotalCostWithGas"]),
                ],
            }
            data.append(entry)
    with open(json_path, 'w') as jsonfile:
        json.dump(data, jsonfile, indent=2)

if __name__ == '__main__':
    main() 