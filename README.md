# Cal Poly Campus Tree Map (2015)

Static Leaflet map built from the 2015 ArborPro campus tree inventory KMZ. It mirrors the Cuesta College tree map UX (search, family filters, list + map), scaled for 6,657 trees.

## Files
- `Cal Poly Core Campus Trees 2015.kmz` — original source file.
- `trees.geojson` — web-friendly dataset generated from the KMZ (6,657 features).
- `index.html` — Leaflet + MarkerCluster front-end; open via any static server.
- `scripts/convert_kmz_to_geojson.py` — reproducible conversion script using only the standard library.

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

## Notes
- The KMZ contained a small number of malformed placemarks without coordinates; those are skipped during conversion.
- Marker clustering is enabled to keep the map responsive with thousands of points. Use search/family chips to narrow the list (first 400 results are rendered for speed).
