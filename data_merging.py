"""
Mill River Visual Analytics — Data Engineering Script
======================================================
Run this script whenever you get new data from Marney.

Input files (put these in the same folder as this script):
    - macros.csv
    - master_taxa.csv
    - env.csv
    - waterQ.csv

Output files (goes into your React app's /public folder):
    - merged_data.json      → used by scatter plots (HLI-1, HLI-2)
    - correlations.json     → used by correlation matrix (HLI-3)

Install dependencies first:
    pip install pandas scipy
"""

import pandas as pd
import json
from scipy.stats import pearsonr

# ─── LOAD ALL 4 CSVs ─────────────────────────────────────────────────
print("Loading CSVs...")

macros    = pd.read_csv("macros.csv")
taxa      = pd.read_csv("master.taxa.csv")
env       = pd.read_csv("env.csv")
waterQ    = pd.read_csv("waterQ.csv")

print(f"  macros:     {len(macros)} rows")
print(f"  master_taxa:{len(taxa)} rows")
print(f"  env:        {len(env)} rows")
print(f"  waterQ:     {len(waterQ)} rows")


# ─── MERGE macros + master_taxa ──────────────────────────────────────
# Join on: scientificName
# Adds to each organism row: family, FFG (feeding group), tolerance
print("\nStep 2: Merging macros + master_taxa on scientificName...")

# Only keep the columns we actually need from taxa
taxa_cols = taxa[["scientificName", "family", "order", "FFG", "tolerance"]]

merged = macros.merge(
    taxa_cols,
    on="scientificName",
    how="left"   # keep all macros rows even if taxa has no match
)

print(f"  Rows after merge: {len(merged)}")
print(f"  Missing family values: {merged['family'].isnull().sum()}")


# ─── MERGE with env ───────────────────────────────────────────────────
# Join on: sampleID
# Adds: conductivity, flow, DO, wTemp, precipitation, discharge, etc.
print("\nStep 3: Merging with env on sampleID...")

# Only keep the env columns we need for visualization
ENV_VARS = [
    "sampleID",
    "cond",           # conductivity  — key variable (road salt indicator)
    "flow",           # water flow speed
    "DO",             # dissolved oxygen
    "wTemp",          # water temperature
    "mon.precip",     # monthly precipitation
    "mon.median.discharge",  # stream discharge
    "pH",
    "turb",           # turbidity
]

env_subset = env[ENV_VARS]

merged = merged.merge(
    env_subset,
    on="sampleID",
    how="left"
)

print(f"  Rows after merge: {len(merged)}")


# ─── CLEAN UP ─────────────────────────────────────────────────────────
print("\nStep 4: Cleaning data...")

# Rename columns to cleaner names for the frontend
merged = merged.rename(columns={
    "mon.precip":            "precip",
    "mon.median.discharge":  "discharge",
    "invDens":               "density",
    "wTemp":                 "waterTemp",
})

# Map FFG codes to readable labels
FFG_LABELS = {
    "cg":  "Collector-gatherer",
    "cf":  "Collector-filterer",
    "scr": "Scraper",
    "sh":  "Shredder",
    "prd": "Predator",
    "om":  "Omnivore",
    "prc": "Parasite",
}
merged["feedingGroup"] = merged["FFG"].map(FFG_LABELS).fillna("Unknown")

# Drop rows where density is missing (can't plot without it)
before = len(merged)
merged = merged.dropna(subset=["density"])
print(f"  Dropped {before - len(merged)} rows with missing density")

# Fill missing env values with None (becomes null in JSON — frontend handles it)
ENV_FINAL = ["cond", "flow", "DO", "waterTemp", "precip", "discharge", "pH", "turb"]
for col in ENV_FINAL:
    merged[col] = merged[col].where(merged[col].notna(), other=None)

# Keep only the columns the frontend needs
FINAL_COLS = [
    "date", "year", "season", "location", "sampleID",
    "scientificName", "family", "order", "feedingGroup", "tolerance",
    "density",
    "cond", "flow", "DO", "waterTemp", "precip", "discharge", "pH", "turb"
]
merged = merged[FINAL_COLS]

print(f"  Final merged rows: {len(merged)}")
print(f"  Unique species: {merged['scientificName'].nunique()}")
print(f"  Unique families: {merged['family'].nunique()}")
print(f"  Years: {sorted(merged['year'].unique())}")
print(f"  Locations: {merged['location'].unique()}")
print(f"  Seasons: {merged['season'].unique()}")


# ─── COMPUTE PEARSON CORRELATIONS ────────────────────────────────────
# For each family × env variable pair, compute r
# This powers HLI-3 (the correlation matrix)
print("\nStep 5: Computing Pearson correlations (family × env variable)...")

ENV_VARS_CORR = ["cond", "flow", "DO", "waterTemp", "precip", "discharge"]
families = sorted(merged["family"].dropna().unique())

corr_rows = []

for family in families:
    family_data = merged[merged["family"] == family]
    row = {"organism": family}

    for env_var in ENV_VARS_CORR:
        # Get pairs where both values exist
        pair = family_data[["density", env_var]].dropna()

        if len(pair) >= 5:  # need at least 5 points for a meaningful correlation
            r, p_value = pearsonr(pair["density"], pair[env_var])
            # pearsonr can return NaN if one variable has zero variance
            row[env_var] = round(float(r), 3) if r == r else None  # r != r means NaN
            row[f"{env_var}_pval"] = round(float(p_value), 4) if p_value == p_value else None
        else:
            row[env_var] = None
            row[f"{env_var}_pval"] = None

    corr_rows.append(row)

corr_df = pd.DataFrame(corr_rows)
print(f"  Correlation matrix: {len(corr_df)} families × {len(ENV_VARS_CORR)} env vars")

# Preview the strongest correlations
print("\n  Top 10 strongest correlations:")
corr_preview = []
for _, row in corr_df.iterrows():
    for env_var in ENV_VARS_CORR:
        val = row[env_var]
        if val is not None:
            corr_preview.append((abs(val), row["organism"], env_var, val))
corr_preview.sort(reverse=True)
for abs_r, org, var, r in corr_preview[:10]:
    print(f"    {org:30s} × {var:12s}  r = {r:+.3f}")


# ─── EXPORT TO JSON ───────────────────────────────────────────────────
print("\nStep 6: Exporting JSON files...")

# merged_data.json — one record per organism observation
merged.to_json("merged_data.json", orient="records", indent=2)
print("  ✓ merged_data.json")

# correlations.json — one record per family
corr_df.to_json("correlations.json", orient="records", indent=2)
print("  ✓ correlations.json")

print("\nDone! Copy both JSON files into your React app's /public folder.")
print(f"  merged_data.json  → {len(merged)} rows")
print(f"  correlations.json → {len(corr_df)} families")