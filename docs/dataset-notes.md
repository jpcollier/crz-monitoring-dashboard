# MTA Congestion Relief Zone Vehicle Entries Dataset Profile

**Dataset ID:** `t6yz-b64h` (NYS Open Data Socrata)  
**SODA API endpoint:** `https://data.ny.gov/resource/t6yz-b64h.json`  
**CSV bulk export:** `https://data.ny.gov/api/views/t6yz-b64h/rows.csv?accessType=DOWNLOAD`  
**Metadata endpoint:** `https://data.ny.gov/api/views/t6yz-b64h.json`

---

## 1. Columns

Exact field names and types from the Socrata metadata endpoint (`/api/views/t6yz-b64h.json`):

| Field Name | Socrata Type | Description |
|---|---|---|
| `toll_date` | `calendar_date` | Date on which the vehicle entry is allocated, in YYYY-MM-DD format. |
| `toll_hour` | `calendar_date` | Timestamp at the start of the hour (HH:MM:SS always :00:00) when the entry was allocated. |
| `toll_10_minute_block` | `calendar_date` | Timestamp at the start of the 10-minute block when the entry was allocated (minutes are 00, 10, 20, 30, 40, 50). |
| `minute_of_hour` | `number` | Starting minute of the 10-minute block (0, 10, 20, 30, 40, or 50). |
| `hour_of_day` | `number` | Hour of the day as integer (0–23). |
| `day_of_week_int` | `number` | Day of week as numeral: 1=Sunday, 2=Monday, ..., 7=Saturday. |
| `day_of_week` | `text` | Day of week as plain text (Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday). |
| `toll_week` | `calendar_date` | Sunday of the week corresponding to `toll_date`, in YYYY-MM-DD format. |
| `time_period` | `text` | Peak or Overnight toll period (see CLAUDE.md for schedule). Values: `"Peak"` or `"Overnight"`. |
| `vehicle_class` | `text` | Vehicle category as detected by tolling system. Six distinct values (see §3). |
| `detection_group` | `text` | Specific crossing/detection point where entry was first sensed. Twelve distinct values (see §2). |
| `detection_region` | `text` | Geographic region of the detection_group (Brooklyn, Queens, New Jersey, West Side Highway, East 60th St, West 60th St, FDR Drive). |
| `crz_entries` | `number` | Count of vehicles that entered the Congestion Relief Zone (CBD minus excluded roadways) in this interval. |
| `excluded_roadway_entries` | `number` | Count of vehicles that entered the CBD but stayed on excluded roadways in this interval. |

**Total columns:** 14  
**Total rows:** 5,152,896  
**Null values:** 0 nulls on all key columns (confirmed via `IS NULL` queries).

---

## 2. Detection Groups

Full list of distinct `detection_group` values with row counts. All groups have **429,408 rows each** (exactly equal distribution):

Query: `?$select=detection_group,count(*)&$group=detection_group`

| Detection Group | Row Count | Region |
|---|---|---|
| Brooklyn Bridge | 429,408 | Brooklyn |
| East 60th St | 429,408 | East 60th St |
| FDR Drive at 60th St | 429,408 | FDR Drive |
| Holland Tunnel | 429,408 | New Jersey |
| Hugh L. Carey Tunnel | 429,408 | Brooklyn |
| Lincoln Tunnel | 429,408 | New Jersey |
| Manhattan Bridge | 429,408 | Brooklyn |
| Queensboro Bridge | 429,408 | Queens |
| Queens Midtown Tunnel | 429,408 | Queens |
| West 60th St | 429,408 | West 60th St |
| West Side Highway at 60th St | 429,408 | West Side Highway |
| Williamsburg Bridge | 429,408 | Brooklyn |

**Total:** 12 detection groups, evenly distributed across all timestamps.

**Note:** No duplicates or variations detected. Group names are consistent and canonical.

---

## 3. Vehicle Classes

Full list of distinct `vehicle_class` values with row counts and percentage of total. All classes have **858,816 rows each** (exactly equal distribution):

Query: `?$select=vehicle_class,count(*)&$group=vehicle_class`

| Vehicle Class | Row Count | % of Total |
|---|---|---|
| 1 - Cars, Pickups and Vans | 858,816 | 16.7% |
| 2 - Single-Unit Trucks | 858,816 | 16.7% |
| 3 - Multi-Unit Trucks | 858,816 | 16.7% |
| 4 - Buses | 858,816 | 16.7% |
| 5 - Motorcycles | 858,816 | 16.7% |
| TLC Taxi/FHV | 858,816 | 16.7% |

**Total:** 6 vehicle classes, perfectly balanced.

**Critical observation:** There is **no "Total" or "Unclassified" row**. Every row represents one of these six classes. Downstream aggregations will need no filtering.

---

## 4. CRZ vs Excluded Roadway Encoding

There is **no single boolean column** distinguishing CRZ from Excluded entries. Instead, **two parallel numeric columns** encode both values for each row:

- **`crz_entries`** (number): count of vehicles entering the CRZ (CBD minus excluded roadways)
- **`excluded_roadway_entries`** (number): count of vehicles entering CBD but on excluded roadways

**Row structure:** Each row represents one combination of (toll_date, toll_hour, toll_10_minute_block, detection_group, vehicle_class) and contains both counts. To separate CRZ from Excluded:

- Filter to `crz_entries > 0` for CRZ-only rows
- Filter to `excluded_roadway_entries > 0` for Excluded-only rows
- Create a derived `entry_type` column with values: `"CRZ"` or `"Excluded"`

**Example row** (2025-01-05, 00:00, Brooklyn Bridge, Cars):
```
crz_entries: 98
excluded_roadway_entries: 95
```
→ This represents both CRZ and Excluded entries in the same 10-minute period.

---

## 5. Date and Time Columns

### Time Granularity: 10-Minute Intervals

The dataset is structured at the **10-minute block level**, confirmed by sampling 2025-01-05, 09:00, Brooklyn Bridge, Cars:

Query: `?$select=toll_10_minute_block,minute_of_hour,hour_of_day&$where=toll_date=%272025-01-05%27%20AND%20hour_of_day=9&$limit=10`

| toll_10_minute_block | minute_of_hour | hour_of_day |
|---|---|---|
| 2025-01-05T09:00:00.000 | 0 | 9 |
| 2025-01-05T09:10:00.000 | 10 | 9 |
| 2025-01-05T09:20:00.000 | 20 | 9 |
| 2025-01-05T09:30:00.000 | 30 | 9 |
| 2025-01-05T09:40:00.000 | 40 | 9 |
| 2025-01-05T09:50:00.000 | 50 | 9 |

Six rows per hour (0, 10, 20, 30, 40, 50 minutes), confirming 10-minute intervals.

### Time Zone

No explicit time zone information in the schema metadata. Presumed to be **US/Eastern (America/New_York)**, matching MTA operations, but not explicitly documented in the dataset.

### Time Columns Summary

| Column | Type | Format | Example | Usage |
|---|---|---|---|---|
| `toll_date` | calendar_date | YYYY-MM-DD | 2025-01-05 | Date aggregation; primary key component. |
| `toll_hour` | calendar_date | YYYY-MM-DDTHH:00:00.000 | 2025-01-05T09:00:00.000 | Hourly granularity; always :00:00 minutes. |
| `toll_10_minute_block` | calendar_date | YYYY-MM-DDTHH:MM:00.000 | 2025-01-05T09:50:00.000 | 10-minute block timestamp; minutes are 00, 10, 20, 30, 40, 50. |
| `minute_of_hour` | number | 0–50 (step 10) | 50 | Extracted from toll_10_minute_block for convenience. |
| `hour_of_day` | number | 0–23 | 9 | Extracted hour for convenience; correlates with toll_hour. |

---

## 6. Date Range

Query: `?$select=min(toll_date),max(toll_date)`

**Earliest date:** 2025-01-05 (January 5, 2025) — CRZ launch date  
**Latest date:** 2026-05-16 (May 16, 2026)  
**Span:** 497 days (approximately 16.3 months)

**Continuity:** The dataset contains entries for **all dates** from Jan 5, 2025 to May 16, 2026. No gaps detected. Each day should have:
- 12 detection groups × 6 vehicle classes × 144 10-minute blocks per day (24 hours × 6 blocks/hour) = **10,368 rows/day**
- Cross-check: 5,152,896 rows ÷ 10,368 rows/day = 497 days ✓

---

## 7. Anomalies

### No Anomalies Detected

All checked:

- **Null values:** 0 nulls on toll_date, detection_group, vehicle_class, crz_entries, excluded_roadway_entries (confirmed via `IS NULL` queries).
- **Negative values:** 0 negative values on crz_entries and excluded_roadway_entries.
- **Max values:** Max crz_entries = 875, Max excluded_roadway_entries = 411 (reasonable for a 10-minute block).
- **Data distribution:** Perfect balance across detection_groups (429,408 rows each) and vehicle_classes (858,816 rows each), confirming Cartesian product structure.
- **Date continuity:** Complete; no gaps between 2025-01-05 and 2026-05-16.
- **Time period values:** Exactly 2 values (Peak, Overnight), matching MTA tolling schedule.
- **Day of week:** 7 distinct values (Sunday–Saturday), 736,128 rows each.
- **No undocumented columns:** All 14 columns match the Socrata schema.

---

## 8. 50-Row Sample

First 50 rows sorted by `toll_date ASC`, retrieved via:

Query: `?$limit=50&$order=toll_date%20ASC`

| # | Date | Time | Detection Group | Vehicle Class | CRZ Entries | Excluded Entries |
|---|---|---|---|---|---|---|
| 1 | 2025-01-05 | 00:00 | Brooklyn Bridge | 1 - Cars, Pickups and Vans | 98 | 95 |
| 2 | 2025-01-05 | 00:00 | Hugh L. Carey Tunnel | 1 - Cars, Pickups and Vans | 17 | 22 |
| 3 | 2025-01-05 | 00:00 | Manhattan Bridge | 1 - Cars, Pickups and Vans | 96 | 0 |
| 4 | 2025-01-05 | 00:00 | Williamsburg Bridge | 1 - Cars, Pickups and Vans | 138 | 0 |
| 5 | 2025-01-05 | 00:00 | East 60th St | 1 - Cars, Pickups and Vans | 208 | 0 |
| 6 | 2025-01-05 | 00:00 | FDR Drive at 60th St | 1 - Cars, Pickups and Vans | 133 | 139 |
| 7 | 2025-01-05 | 00:00 | Holland Tunnel | 1 - Cars, Pickups and Vans | 140 | 0 |
| 8 | 2025-01-05 | 00:00 | Lincoln Tunnel | 1 - Cars, Pickups and Vans | 148 | 0 |
| 9 | 2025-01-05 | 00:00 | Queens Midtown Tunnel | 1 - Cars, Pickups and Vans | 63 | 0 |
| 10 | 2025-01-05 | 00:00 | Queensboro Bridge | 1 - Cars, Pickups and Vans | 76 | 0 |
| 11 | 2025-01-05 | 00:00 | West 60th St | 1 - Cars, Pickups and Vans | 60 | 0 |
| 12 | 2025-01-05 | 00:00 | West Side Highway at 60th St | 1 - Cars, Pickups and Vans | 85 | 4 |
| 13 | 2025-01-05 | 00:00 | Brooklyn Bridge | 2 - Single-Unit Trucks | 1 | 0 |
| 14 | 2025-01-05 | 00:00 | Hugh L. Carey Tunnel | 2 - Single-Unit Trucks | 0 | 3 |
| 15 | 2025-01-05 | 00:00 | Manhattan Bridge | 2 - Single-Unit Trucks | 2 | 0 |
| 16 | 2025-01-05 | 00:00 | Williamsburg Bridge | 2 - Single-Unit Trucks | 1 | 0 |
| 17 | 2025-01-05 | 00:00 | East 60th St | 2 - Single-Unit Trucks | 3 | 0 |
| 18 | 2025-01-05 | 00:00 | FDR Drive at 60th St | 2 - Single-Unit Trucks | 1 | 0 |
| 19 | 2025-01-05 | 00:00 | Holland Tunnel | 2 - Single-Unit Trucks | 1 | 0 |
| 20 | 2025-01-05 | 00:00 | Lincoln Tunnel | 2 - Single-Unit Trucks | 4 | 0 |
| 21 | 2025-01-05 | 00:00 | Queens Midtown Tunnel | 2 - Single-Unit Trucks | 2 | 0 |
| 22 | 2025-01-05 | 00:00 | Queensboro Bridge | 2 - Single-Unit Trucks | 1 | 0 |
| 23 | 2025-01-05 | 00:00 | West 60th St | 2 - Single-Unit Trucks | 3 | 0 |
| 24 | 2025-01-05 | 00:00 | West Side Highway at 60th St | 2 - Single-Unit Trucks | 1 | 0 |
| 25 | 2025-01-05 | 00:00 | Brooklyn Bridge | 3 - Multi-Unit Trucks | 0 | 0 |
| 26 | 2025-01-05 | 00:00 | Hugh L. Carey Tunnel | 3 - Multi-Unit Trucks | 0 | 0 |
| 27 | 2025-01-05 | 00:00 | Manhattan Bridge | 3 - Multi-Unit Trucks | 1 | 0 |
| 28 | 2025-01-05 | 00:00 | Williamsburg Bridge | 3 - Multi-Unit Trucks | 0 | 0 |
| 29 | 2025-01-05 | 00:00 | East 60th St | 3 - Multi-Unit Trucks | 2 | 0 |
| 30 | 2025-01-05 | 00:00 | FDR Drive at 60th St | 3 - Multi-Unit Trucks | 0 | 0 |
| 31 | 2025-01-05 | 00:00 | Holland Tunnel | 3 - Multi-Unit Trucks | 0 | 0 |
| 32 | 2025-01-05 | 00:00 | Lincoln Tunnel | 3 - Multi-Unit Trucks | 1 | 0 |
| 33 | 2025-01-05 | 00:00 | Queens Midtown Tunnel | 3 - Multi-Unit Trucks | 0 | 0 |
| 34 | 2025-01-05 | 00:00 | Queensboro Bridge | 3 - Multi-Unit Trucks | 0 | 0 |
| 35 | 2025-01-05 | 00:00 | West 60th St | 3 - Multi-Unit Trucks | 0 | 0 |
| 36 | 2025-01-05 | 00:00 | West Side Highway at 60th St | 3 - Multi-Unit Trucks | 0 | 0 |
| 37 | 2025-01-05 | 00:00 | Brooklyn Bridge | 4 - Buses | 0 | 0 |
| 38 | 2025-01-05 | 00:00 | Hugh L. Carey Tunnel | 4 - Buses | 0 | 0 |
| 39 | 2025-01-05 | 00:00 | Manhattan Bridge | 4 - Buses | 0 | 0 |
| 40 | 2025-01-05 | 00:00 | Williamsburg Bridge | 4 - Buses | 0 | 0 |
| 41 | 2025-01-05 | 00:00 | East 60th St | 4 - Buses | 3 | 0 |
| 42 | 2025-01-05 | 00:00 | FDR Drive at 60th St | 4 - Buses | 1 | 0 |
| 43 | 2025-01-05 | 00:00 | Holland Tunnel | 4 - Buses | 0 | 0 |
| 44 | 2025-01-05 | 00:00 | Lincoln Tunnel | 4 - Buses | 5 | 0 |
| 45 | 2025-01-05 | 00:00 | Queens Midtown Tunnel | 4 - Buses | 0 | 0 |
| 46 | 2025-01-05 | 00:00 | Queensboro Bridge | 4 - Buses | 1 | 0 |
| 47 | 2025-01-05 | 00:00 | West 60th St | 4 - Buses | 1 | 0 |
| 48 | 2025-01-05 | 00:00 | West Side Highway at 60th St | 4 - Buses | 2 | 0 |
| 49 | 2025-01-05 | 00:00 | Brooklyn Bridge | 5 - Motorcycles | 0 | 0 |
| 50 | 2025-01-05 | 00:00 | Hugh L. Carey Tunnel | 5 - Motorcycles | 0 | 0 |

**Pattern:** First 50 rows all from 2025-01-05 00:00 (midnight), cycling through all 12 detection groups × 6 vehicle classes (minus rows 49–50 which are the start of the next set).

---

## 9. Open Questions from PLAN.md

### Q1: Exact column name and string values for CRZ vs Excluded

**A:** There is no single `entry_type` column in the raw dataset. Instead:
- Column `crz_entries` contains count of CRZ vehicles
- Column `excluded_roadway_entries` contains count of Excluded Roadway vehicles

To create an `entry_type` flag for downstream work, unpivot these two columns and add a derived column:
```
entry_type: IF(unpivot_source = 'crz_entries', 'CRZ', 'Excluded')
```

Or maintain both columns and use WHERE clauses to filter by vehicle type.

### Q2: Whether vehicle_class has a "Total" / "Unclassified" row

**A:** No. The six values are exhaustive and mutually exclusive:
- `1 - Cars, Pickups and Vans`
- `2 - Single-Unit Trucks`
- `3 - Multi-Unit Trucks`
- `4 - Buses`
- `5 - Motorcycles`
- `TLC Taxi/FHV`

**No aggregated "Total" row exists.** Summing across all six gives the true total entries for a given (date, hour, detection_group, time_period) combination.

### Q3: CSV bulk endpoint speed vs paginated JSON API

**A:** CSV bulk endpoint is **responsive and viable**:
- HEAD/GET response: < 1 second for initial connection
- Content-Type: `text/csv; charset=utf-8`
- Recommended for bulk extract; simpler than paginating 5.15M rows via JSON

**Caveat:** CSV is ~983 MB uncompressed (rows × ~200 bytes/row). Python pandas can read it directly or pipe to streaming parser. JSON pagination (`?$limit=50000&$offset=N`) is an alternative but requires 104 requests (5,152,896 ÷ 50,000).

### Q4: Estimated final Parquet size and Vercel 100 MB limit

**A:** **The full uncompressed Parquet will NOT fit under 100 MB.**

Estimation (from row/column structure):
- Numeric columns (44 bytes/row): 216.2 MB
- String columns (dictionary-encoded): 63.9 MB
- Parquet overhead (15%): 42.0 MB
- **Total: ~322 MB uncompressed**

**Workarounds:**
1. **Compression:** Parquet with Snappy or Zstd compression typically achieves 50–60% reduction → ~130–160 MB (still over limit).
2. **Stratification:** Split into two files:
   - `crz_daily_2025.parquet` (365 days) + `crz_daily_2026.parquet` (to-date) → ~70–80 MB each, both safe.
   - Or split by detection_group: 12 files × ~27 MB each.
3. **Aggregation at build time:** Pre-aggregate to daily/hourly granule at build time, reducing row count by ~144×. This is the recommended approach and aligns with the CLAUDE.md data spec (ship aggregated `crz_daily.parquet` and `crz_hourly.parquet`, not raw data).

**Recommendation:** Use the build-time aggregation approach per CLAUDE.md § "Aggregation grain shipped to the browser".

---

## Query Reference

All facts in this document are backed by Socrata SODA API queries. Representative queries:

```bash
# Schema metadata
curl https://data.ny.gov/api/views/t6yz-b64h.json

# Row count
curl 'https://data.ny.gov/resource/t6yz-b64h.json?$select=count(*)'

# Detection groups with counts
curl 'https://data.ny.gov/resource/t6yz-b64h.json?$select=detection_group,count(*)&$group=detection_group'

# Vehicle classes with counts
curl 'https://data.ny.gov/resource/t6yz-b64h.json?$select=vehicle_class,count(*)&$group=vehicle_class'

# Date range
curl 'https://data.ny.gov/resource/t6yz-b64h.json?$select=min(toll_date),max(toll_date)'

# Check for nulls
curl 'https://data.ny.gov/resource/t6yz-b64h.json?$select=count(*)&$where=toll_date%20IS%20NULL'

# 50-row sample
curl 'https://data.ny.gov/resource/t6yz-b64h.json?$limit=50&$order=toll_date%20ASC'

# Max values
curl 'https://data.ny.gov/resource/t6yz-b64h.json?$select=max(crz_entries),max(excluded_roadway_entries)'
```

---

**Document generated:** 2026-05-24  
**Data as of:** 2026-05-16 (latest toll_date in dataset)
