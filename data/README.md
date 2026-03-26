# FIFA / FC 26 Player Data

Place the FC 26 (FIFA 26) player dataset CSV here as `fc26-players.csv`.

## Download Instructions

1. Visit [Kaggle FC 26 dataset](https://www.kaggle.com/datasets/) and search for "FC 26" or "FIFA 26"
2. Download the main players CSV
3. Rename it to `fc26-players.csv` and place it in this directory

## Expected Columns

The CSV parser looks for these columns (case-sensitive):
- `Name` or `LongName` or `Known As` — player name
- `Overall` or `OVA` — overall rating
- `Potential` or `POT` — potential rating
- `Age` — player age
- `Positions` or `Best Position` or `Position` — positions (comma or slash separated)
- `Club` — club name (e.g. "Arsenal", "Newcastle United")
- `Value` or `ValueEUR` — market value in euros
- `Wage` or `WageEUR` — weekly wage in euros
- `PAC`/`Pace`, `SHO`/`Shooting`, `PAS`/`Passing`, `DRI`/`Dribbling`, `DEF`/`Defending`, `PHY`/`Physicality` — attributes

## Without the CSV

The V5 What-If feature works without this file, but squad quality analysis (compare_squads, lookup_player tools) will return empty results. The agent will fall back to web search for player information.
