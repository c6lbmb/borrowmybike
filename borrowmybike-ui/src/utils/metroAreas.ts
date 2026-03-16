export type MetroGroup = {
  key: string;
  province: string;
  label: string;
  launchCity: string;
  cities: string[];
};

export const METRO_GROUPS: MetroGroup[] = [
  {
    key: "calgary",
    province: "AB",
    label: "Calgary",
    launchCity: "Calgary",
    cities: [
      "Calgary",
      "Airdrie",
      "Chestermere",
      "Cochrane",
      "Okotoks",
      "De Winton",
    ],
  },
  {
    key: "edmonton",
    province: "AB",
    label: "Edmonton",
    launchCity: "Edmonton",
    cities: [
      "Edmonton",
      "Sherwood Park",
      "St. Albert",
      "Spruce Grove",
      "Stony Plain",
      "Leduc",
      "Beaumont",
      "Fort Saskatchewan",
    ],
  },
  {
    key: "red_deer",
    province: "AB",
    label: "Red Deer",
    launchCity: "Red Deer",
    cities: [
      "Red Deer",
      "Blackfalds",
      "Lacombe",
      "Penhold",
      "Sylvan Lake",
    ],
  },
  {
    key: "lethbridge",
    province: "AB",
    label: "Lethbridge",
    launchCity: "Lethbridge",
    cities: [
      "Lethbridge",
      "Coaldale",
      "Coalhurst",
      "Picture Butte",
      "Taber",
    ],
  },
  {
    key: "medicine_hat",
    province: "AB",
    label: "Medicine Hat",
    launchCity: "Medicine Hat",
    cities: [
      "Medicine Hat",
      "Redcliff",
    ],
  },
  {
    key: "grande_prairie",
    province: "AB",
    label: "Grande Prairie",
    launchCity: "Grande Prairie",
    cities: [
      "Grande Prairie",
      "Clairmont",
      "Sexsmith",
    ],
  },
  {
    key: "fort_mcmurray",
    province: "AB",
    label: "Fort McMurray",
    launchCity: "Fort McMurray",
    cities: [
      "Fort McMurray",
    ],
  },

  // Keep BC helpers here for later expansion, but Alberta remains the launch priority.
  {
    key: "vancouver",
    province: "BC",
    label: "Vancouver",
    launchCity: "Vancouver",
    cities: [
      "Vancouver",
      "Burnaby",
      "New Westminster",
      "Surrey",
      "Coquitlam",
      "Port Coquitlam",
      "Port Moody",
      "Richmond",
      "Delta",
      "Langley",
      "Abbotsford",
    ],
  },
];

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export const METRO_AREAS: Record<string, string[]> = Object.fromEntries(
  METRO_GROUPS.map((group) => [group.key, group.cities.map((city) => normalize(city))]),
);

export function getMetroCities(city: string): string[] {
  const normalized = normalize(city);

  for (const group of METRO_GROUPS) {
    const groupCities = group.cities.map((c) => normalize(c));
    if (groupCities.includes(normalized)) {
      return groupCities;
    }
  }

  return normalized ? [normalized] : [];
}

export function getMetroGroup(city: string): MetroGroup | null {
  const normalized = normalize(city);

  for (const group of METRO_GROUPS) {
    if (group.cities.some((c) => normalize(c) === normalized)) {
      return group;
    }
  }

  return null;
}

export function getLaunchCityOptions(province: string): string[] {
  return METRO_GROUPS.filter((group) => group.province === province)
    .map((group) => group.launchCity);
}

export function getBaseCityOptions(province: string): string[] {
  return getLaunchCityOptions(province);
}

export function getServiceCitiesForBaseCity(baseCity: string): string[] {
  const group = getMetroGroup(baseCity);
  if (!group) return [];

  const baseNormalized = normalize(baseCity);

  return group.cities.filter((city) => normalize(city) !== baseNormalized);
}