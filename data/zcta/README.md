# ZIP → location data

`zcta-2025.csv` maps US ZIP codes to an approximate center point. Used only for the booking travel check (ELIG-2): "is this venue roughly within an hour of Lincoln?"

| | |
|---|---|
| Source | U.S. Census Bureau, 2025 Gazetteer Files, ZIP Code Tabulation Areas (ZCTA) |
| URL | https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip |
| Source zip SHA-256 | `51516a4283bab5cd2376eec75609ddc4b363a18297e8adeeaac7b03cf7c84dbe` |
| Output SHA-256 | `5b333cc4a58b893076acdc162437153e5b44ebc3d29186a8ddf56c4fb9c73992` |
| License | US federal government work, public domain |
| Rows | 33,791 (5-digit ZIP, no duplicates) |
| Columns | `zip,lat,lng` (internal point latitude/longitude, WGS84 decimal degrees) |
| Size | ~0.9 MB |

## Caveats

- ZCTAs approximate ZIP codes; they are not identical. PO-box-only and some business ZIPs have no ZCTA. A ZIP not in this file is treated as "location unknown," which sends the request to the contact path (ELIG-3). That's the safe failure.
- The point is the area's interior point, not the venue. Accuracy is a few miles in town, more in large rural ZIPs. Fine for a ~60 mile cutoff.

## Spot check (straight-line from Lincoln, 40.8136, -96.7026)

| ZIP | Place | Miles | 60 mi rule |
|---|---|---|---|
| 68508 | Lincoln downtown | 0.3 | quote |
| 68434 | Seward | 22.7 | quote |
| 68310 | Beatrice | 39.0 | quote |
| 68154 | Omaha (west) | 43.7 | quote |
| 68025 | Fremont | 44.5 | quote |
| 68410 | Nebraska City | 44.6 | quote |
| 68467 | York | 46.9 | quote |
| 68102 | Omaha (downtown) | 50.7 | quote |
| 51501 | Council Bluffs, IA | 51.1 | quote |
| 68601 | Columbus | 57.0 | quote |
| 68801 | Grand Island | 83.8 | contact |
| 68847 | Kearney | 121.4 | contact |
| 66502 | Manhattan, KS | 116.0 | contact |
| 64105 | Kansas City, MO | 162.6 | contact |

## Regenerate

```zsh
curl -sSfO "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_zcta_national.zip"
unzip -o 2025_Gaz_zcta_national.zip
awk -F'|' 'NR==1{next} {gsub(/[ \t\r]+$/,"",$8); print $1","$7","$8}' 2025_Gaz_zcta_national.txt \
  | sort -t, -k1,1 | { echo "zip,lat,lng"; cat; } > zcta-2025.csv
```

Census publishes a new Gazetteer each year; ZCTAs only change meaningfully after each decennial census, so refreshing is optional.
