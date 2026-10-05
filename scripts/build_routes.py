"""Fill in real map geometry for docs/trip.json.

Each drive gets a road route from OSRM, the Arrowhead Lake Trail follows the lake shore and the
Ragged Falls paddle follows the Oxtongue River (both from OpenStreetMap). Results are stored as
Google encoded polylines in a "geom" field so the page can draw them on Google Maps.

Re-run after changing a drive's start/end:  python3 scripts/build_routes.py
"""

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TRIP = Path(__file__).resolve().parent.parent / "docs" / "trip.json"
UA = {"User-Agent": "algonquin-trip-planner/1.0 (personal trip page)", "Accept": "application/json"}


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def encode(points):
    """Google encoded polyline, precision 5."""
    out, plat, plon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def decode(s):
    pts, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        vals = []
        for _ in range(2):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                res |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]
        lon += vals[1]
        pts.append((lat / 1e5, lon / 1e5))
    return pts


def dist(a, b):
    k = math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot((a[0] - b[0]) * 111.2, (a[1] - b[1]) * 111.32 * k)


def osm(query, tries=4):
    data = urllib.parse.urlencode({"data": query}).encode()
    for i in range(tries):
        try:
            return get("https://overpass-api.de/api/interpreter", data)["elements"]
        except urllib.error.HTTPError as e:  # Overpass is often busy (429/504); back off and retry
            if i == tries - 1 or e.code not in (429, 502, 503, 504):
                raise
            time.sleep(5 * (i + 1))


def drive(points):
    coords = ";".join(f"{lon},{lat}" for lat, lon in points)
    r = get(f"https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=polyline")
    route = r["routes"][0]
    pts = decode(route["geometry"])
    # thin very long routes: keep a point every ~150 m
    keep = [pts[0]]
    for p in pts[1:-1]:
        if dist(keep[-1], p) > 0.15:
            keep.append(p)
    keep.append(pts[-1])
    return keep, route["distance"] / 1000, route["duration"] / 60


def main():
    trip = json.loads(TRIP.read_text())
    places = trip["places"]
    ll = lambda x: tuple(places[x]["ll"]) if isinstance(x, str) else tuple(x)

    for day in trip["days"].values():
        for s in day["segs"]:
            if s["t"] != "drive":
                continue
            path = s["path"]
            # endpoints, plus Huntsville when the plan routes through it (keeps OSRM off Hwy 35)
            via = [path[0]] + [p for p in path[1:-1] if p == "hunts"] + [path[-1]]
            pts, km, mins = drive([ll(p) for p in via])
            s["geom"] = encode(pts)
            print(f"{s['label']:<34} {km:6.1f} km  {mins:5.0f} min (plan {s['start']}-{s['end']})")
            time.sleep(1)

    lake = osm("[out:json];way(81049763);out geom;")[0]["geometry"]
    river = {e["id"]: e["geometry"] for e in osm('[out:json];way(id:1541275983,1541275977);out geom;')}

    for day in trip["days"].values():
        for s in day["segs"]:
            if s.get("routeKind") == "hike" and s["place"] == "beach":
                shore = [(p["lat"], p["lon"]) for p in lake][:-1]
                start = min(range(len(shore)), key=lambda i: dist(shore[i], ll("beach")))
                loop = shore[start:] + shore[: start + 1]
                s["route"] = None
                s["geom"] = encode(loop[::2] + [loop[-1]])
            if s.get("routeKind") == "paddle":
                # river ways run downstream; paddle upstream from where the river meets Oxtongue Lake
                up = [(p["lat"], p["lon"]) for p in river[1541275983]][::-1]
                up += [(p["lat"], p["lon"]) for p in river[1541275977]][::-1][1:]
                falls = ll("ragged")
                cut = min(range(len(up)), key=lambda i: dist(up[i], falls))
                out = [ll("aostore")] + up[: cut + 1] + [falls]
                s["route"] = None
                s["geom"] = encode(out + out[::-1][1:])
            if s.get("route") is None and "route" in s:
                del s["route"]

    TRIP.write_text(json.dumps(trip, indent=1, ensure_ascii=False))
    print("wrote", TRIP)


if __name__ == "__main__":
    main()
