import fs from "node:fs/promises";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  throw new Error("Missing GOOGLE_MAPS_API_KEY");
}

const cities = [
  "Calgary, Alberta",
  "Airdrie, Alberta",
  "Okotoks, Alberta",
  "Chestermere, Alberta",
  "Cochrane, Alberta",
  "Strathmore, Alberta",
  "High River, Alberta",
  "Edmonton, Alberta",
  "St. Albert, Alberta",
  "Sherwood Park, Alberta",
  "Spruce Grove, Alberta",
  "Leduc, Alberta",
  "Fort Saskatchewan, Alberta",
  "Red Deer, Alberta",
  "Lethbridge, Alberta",
  "Medicine Hat, Alberta",
  "Grande Prairie, Alberta",
  "Fort McMurray, Alberta",
];

function escapeCsv(value) {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function inferCityFromAddress(address = "") {
  const known = [
    "Calgary",
    "Airdrie",
    "Okotoks",
    "Chestermere",
    "Cochrane",
    "Strathmore",
    "High River",
    "Edmonton",
    "St. Albert",
    "Sherwood Park",
    "Spruce Grove",
    "Leduc",
    "Fort Saskatchewan",
    "Red Deer",
    "Lethbridge",
    "Medicine Hat",
    "Grande Prairie",
    "Fort McMurray",
  ];

  for (const city of known) {
    if (address.toLowerCase().includes(city.toLowerCase())) return city;
  }
  return "";
}

function extractPostalCode(address = "") {
  const m = address.match(/\b([A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : "";
}

async function searchCity(cityQuery) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({
      textQuery: `registry agent in ${cityQuery}`,
      pageSize: 20,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places error for ${cityQuery}: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.places ?? [];
}

async function main() {
  const byPlaceId = new Map();

  for (const city of cities) {
    console.log(`Searching: ${city}`);
    const places = await searchCity(city);

    for (const place of places) {
      const placeId = place.id;
      if (!placeId) continue;
      if (byPlaceId.has(placeId)) continue;

      const name = place.displayName?.text ?? "";
      const address = place.formattedAddress ?? "";
      const cityName = inferCityFromAddress(address);
      const lat = place.location?.latitude ?? "";
      const lng = place.location?.longitude ?? "";
      const postalCode = extractPostalCode(address);

      byPlaceId.set(placeId, {
        name,
        city: cityName,
        address,
        province: "AB",
        postal_code: postalCode,
        latitude: lat,
        longitude: lng,
        is_active: true,
        notes: "",
      });
    }
  }

  const rows = Array.from(byPlaceId.values()).sort((a, b) => {
    if (a.city !== b.city) return a.city.localeCompare(b.city);
    return a.name.localeCompare(b.name);
  });

  const header = [
    "name",
    "city",
    "address",
    "province",
    "postal_code",
    "latitude",
    "longitude",
    "is_active",
    "notes",
  ];

  const csv = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.name,
        row.city,
        row.address,
        row.province,
        row.postal_code,
        row.latitude,
        row.longitude,
        row.is_active,
        row.notes,
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ].join("\n");

  await fs.writeFile("registries-import.csv", csv, "utf8");
  console.log(`Done. Wrote ${rows.length} rows to registries-import.csv`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
