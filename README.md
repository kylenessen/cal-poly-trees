# Cal Poly Campus Tree Map (2015)

Static MapLibre GL JS map built from the 2015 ArborPro campus tree inventory KMZ.

## What it does
- Renders all 6,624 trees with no clustering.
- Keeps labels visible by default using MapLibre symbol collision handling.
- Preserves filter/search UX:
  - Group
  - Family
  - Condition
  - Height range
  - DBH range
  - Text search
- Preserves geolocation and basemap toggle (Carto Light / Esri World Imagery).
- Deploys as static files only (GitHub Pages compatible).

## Files
- `Cal Poly Core Campus Trees 2015.kmz` — original source file.
- `trees.geojson` — web-friendly dataset generated from the KMZ (6,624 features).
- `index.html` — MapLibre GL JS front-end.
- `scripts/convert_kmz_to_geojson.py` — reproducible conversion script using only the standard library.
- `scripts/benchmark-map.mjs` — repeatable browser benchmark harness.
- `perf/before-leaflet.json` — baseline benchmark snapshot.
- `perf/after-maplibre.json` — post-refactor benchmark snapshot.

## Running locally
```bash
cd /Users/kylenessen/Documents/Code/cal-poly-trees
python3 -m http.server 8000
# visit http://localhost:8000
```

## Regenerating the data
If the KMZ changes, regenerate `trees.geojson`:
```bash
python3 scripts/convert_kmz_to_geojson.py
```

## Performance benchmark
Install benchmark deps:
```bash
npm install
npx playwright install firefox
```

Run baseline / after snapshots:
```bash
npm run bench:map:before
npm run bench:map:after
```

Current mean results (Firefox headless, 5 runs + 1 warmup):
- Ready time: 1658.59 ms -> 681.32 ms (-58.9%)
- Search `oak`: 452.60 ms -> 219.40 ms (-51.5%)
- Family toggle: 228.40 ms -> 24.40 ms (-89.3%)
- Min height filter: 231.20 ms -> 24.20 ms (-89.5%)
- Clear all filters: 945.80 ms -> 25.60 ms (-97.3%)
- DOM nodes: 6814 -> 150 (-97.8%)

## Notes
- The KMZ contained a small number of malformed placemarks without coordinates; those are skipped during conversion.
