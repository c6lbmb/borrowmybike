import fs from "node:fs/promises";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!GOOGLE_MAPS_API_KEY) {
  throw new Error("Missing GOOGLE_MAPS_API_KEY");
}

const cities = [
  "Vancouver, British Columbia",
  "North Vancouver, British Columbia",
  "West Vancouver, British Columbia",
  "Burnaby, British Columbia",
  "New Westminster, British Columbia",
  "Richmond, British Columbia",
  "Surrey, British Columbia",
  "Coquitlam, British Columbia",
  "Port Coquitlam, British Columbia",
  "Port Moody, British Columbia",
  "Delta, British Columbia",
  "White Rock, British Columbia",
  "Langley, British Columbia",
  "Maple Ridge, British Columbia",
  "Abbotsford, British Columbia",
  "Kelowna, British Columbia",
  "Kamloops, British Columbia",
  "Victoria, British Columbia",
  "Nanaimo, British Columbia",
  "Prince George, British Columbia",
];

const textQueries = [
  (cityQuery) => `ICBC driver licensing office in ${cityQuery}`,
  (cityQuery) => `ICBC road test in ${cityQuery}`,
  (cityQuery) => `ICBC motorcycle skills test in ${cityQuery}`,
];

const EXCLUDED_TERMS = [
  "motorcycle school",
  "riding school",
  "driver training",
  "rider training",
  "training school",
  "academy",
  "learn to ride",
  "driving school",
  "motorcycle training",
  "motorcycle academy",
  "safety council",
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
    "North Vancouver",
    "West Vancouver",
    "New Westminster",
    "Port Coquitlam",
    "Port Moody",
    "Maple Ridge",
    "White Rock",
    "Prince George",
    "Vancouver",
    "Burnaby",
    "Richmond",
    "Surrey",
    "Coquitlam",
    "Delta",
    "Langley",
    "Abbotsford",
    "Kelowna",
    "Kamloops",
    "Victoria",
    "Nanaimo",
  ];

  const lower = address.toLowerCase();

  for (const city of known) {
    if (lower.includes(city.toLowerCase())) return city;
  }

  return "";
}

function extractPostalCode(address = "") {
  const m = address.match(/\b([A-Z]\d[A-Z][ -]?\d[A-Z]\d)\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/, " ") : "";
}

function shouldExcludePlace(name = "", address = "") {
  const haystack = `${name} ${address}`.toLowerCase();
  return EXCLUDED_TERMS.some((term) => haystack.includes(term));
}

function scorePlace(name = "", address = "") {
  const haystack = `${name} ${address}`.toLowerCase();
  let score = 0;

  if (haystack.includes("icbc")) score += 10;
  if (haystack.includes("driver licensing")) score += 5;
  if (haystack.includes("road test")) score += 5;
  if (haystack.includes("licensing")) score += 3;
  if (haystack.includes("service bc")) score -= 3;
  if (haystack.includes("insurance")) score -= 2;

  return score;
}

async function searchTextQuery(textQuery) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({
      textQuery,
      pageSize: 20,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Places error for "${textQuery}": ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.places ?? [];
}

async function main() {
  const byPlaceId = new Map();

  for (const city of cities) {
    for (const makeQuery of textQueries) {
      const query = makeQuery(city);
      console.log(`Searching: ${query}`);
      const places = await searchTextQuery(query);

      for (const place of places) {
        const placeId = place.id;
        if (!placeId) continue;

        const name = place.displayName?.text ?? "";
        const address = place.formattedAddress ?? "";

        if (shouldExcludePlace(name, address)) {
          console.log(`Skipping likely school/training result: ${name}`);
          continue;
        }

        const cityName = inferCityFromAddress(address);
        const lat = place.location?.latitude ?? "";
        const lng = place.location?.longitude ?? "";
        const postalCode = extractPostalCode(address);
        const score = scorePlace(name, address);

        const candidate = {
          name,
          city: cityName,
          address,
          province: "BC",
          postal_code: postalCode,
          latitude: lat,
          longitude: lng,
          is_active: true,
          notes: "",
          score,
        };

        const existing = byPlaceId.get(placeId);
        if (!existing || candidate.score > existing.score) {
          byPlaceId.set(placeId, candidate);
        }
      }
    }
  }

  const rows = Array.from(byPlaceId.values())
    .filter((row) => row.score >= 0)
    .sort((a, b) => {
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

  await fs.writeFile("bc-icbc-locations-import.csv", csv, "utf8");
  console.log(`Done. Wrote ${rows.length} rows to bc-icbc-locations-import.csv`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});