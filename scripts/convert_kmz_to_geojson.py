#!/usr/bin/env python3
"""Convert the provided KMZ inventory to GeoJSON.

- Reads ``Cal Poly Core Campus Trees 2015.kmz`` (expected in repo root)
- Extracts placemarks, normalizes their HTML descriptions, and keeps useful
  attributes for the web map
- Writes ``trees.geojson`` in the repo root

Only the Python standard library is used so the script can run anywhere.
"""
from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass, asdict
from html import unescape
from pathlib import Path
import xml.etree.ElementTree as ET

# Paths
REPO_ROOT = Path(__file__).resolve().parent.parent
KMZ_PATH = REPO_ROOT / "Cal Poly Core Campus Trees 2015.kmz"
OUTPUT_PATH = REPO_ROOT / "trees.geojson"

# Namespaces (the KML omits an xsi declaration, so we strip that before parsing)
NS = {"kml": "http://www.opengis.net/kml/2.2"}


@dataclass
class TreeRecord:
    tree_id: int
    common_name: str | None
    scientific_name: str | None
    family: str | None
    category: str | None  # e.g., "Pteridophytes > Ferns"
    individual_number: int | None
    campus_total: int | None
    height_ft: float | None
    dbh_in: float | None
    condition: str | None
    abundance_rank: int | None
    abundance_total: int | None
    last_update: str | None
    location: str | None
    identified_by: str | None
    selectree_url: str | None
    wikipedia_url: str | None
    google_maps_url: str | None

    def to_feature(self, lon: float, lat: float) -> dict:
        props = {k: v for k, v in asdict(self).items() if v is not None}
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": props,
        }


def normalize_xml(raw_xml: str) -> str:
    """Remove unsupported namespace declarations so ElementTree can parse."""
    return re.sub(r"\s+xsi:schemaLocation=\"[^\"]*\"", "", raw_xml)


def parse_measure(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", value)
    return float(match.group(1)) if match else None


def parse_description(desc: str) -> dict:
    desc = desc or ""
    # Compact whitespace to make regex matching easier
    desc = unescape(desc)

    def grab(pattern: str, flags=0):
        m = re.search(pattern, desc, flags)
        return m.group(1).strip() if m else None

    individual = re.search(r"<dd><b>(\d+) of (\d+)</b> on campus", desc, re.I)
    abundance = re.search(r"abundance rank <b>(\d+) of (\d+)</b>", desc, re.I)

    links = re.findall(r"<a[^>]+href=\"([^\"]+)\"[^>]*><b>([^<]+)</b></a>", desc)
    link_map = {label.strip(): href.strip() for href, label in links}

    return {
        "scientific_name": grab(r"<h2>(.*?)</h2>"),
        "family": grab(r"<h3>(.*?)</h3>"),
        "category": grab(r"<h4>(.*?)</h4>"),
        "individual_number": int(individual.group(1)) if individual else None,
        "campus_total": int(individual.group(2)) if individual else None,
        "height_ft": parse_measure(grab(r"height <b>(.*?)</b>", re.I)),
        "dbh_in": parse_measure(grab(r"DBH <b>(.*?)</b>", re.I)),
        "condition": grab(r"condition <b>(.*?)</b>", re.I),
        "abundance_rank": int(abundance.group(1)) if abundance else None,
        "abundance_total": int(abundance.group(2)) if abundance else None,
        "last_update": grab(r"last update <b>(.*?)</b>", re.I),
        "location": grab(r"<dt>Location</<dt>\s*<dd>(.*?)</dd>", re.S),
        "identified_by": grab(r"ID by <b>(.*?)</b>", re.I),
        "selectree_url": link_map.get("UFEI SelecTree"),
        "wikipedia_url": link_map.get("Wikipedia"),
        "google_maps_url": link_map.get("Google maps"),
    }


def load_kml_root():
    if not KMZ_PATH.exists():
        raise FileNotFoundError(f"KMZ not found at {KMZ_PATH}")

    with zipfile.ZipFile(KMZ_PATH) as zf:
        raw_xml = zf.read("doc.kml").decode("utf-8")

    clean_xml = normalize_xml(raw_xml)
    return ET.fromstring(clean_xml)


def build_geojson():
    root = load_kml_root()
    placemarks = root.findall(".//kml:Placemark", NS)

    features = []
    for idx, pm in enumerate(placemarks, start=1):
        name_el = pm.find("kml:name", NS)
        common_name = name_el.text.strip() if name_el is not None and name_el.text else None

        coord_el = pm.find(".//kml:coordinates", NS)
        coord_text = coord_el.text.strip() if coord_el is not None and coord_el.text else ""
        parts = coord_text.split(",")
        if len(parts) < 2:
            # Skip malformed placemarks (only a couple of rows)
            continue
        lon, lat = float(parts[0]), float(parts[1])

        desc_el = pm.find("kml:description", NS)
        desc_html = desc_el.text if desc_el is not None else ""

        parsed = parse_description(desc_html)
        record = TreeRecord(
            tree_id=idx,
            common_name=common_name,
            **parsed,
        )
        features.append(record.to_feature(lon, lat))

    return {"type": "FeatureCollection", "features": features}


def main():
    geojson = build_geojson()
    OUTPUT_PATH.write_text(json.dumps(geojson, indent=2))
    print(f"Wrote {len(geojson['features'])} features to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
