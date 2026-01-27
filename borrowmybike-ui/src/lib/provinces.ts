// src/lib/provinces.ts

export type ProvinceCode =
  | "BC"
  | "AB"
  | "SK"
  | "MB"
  | "ON"
  | "QC"
  | "NB"
  | "NS"
  | "PE"
  | "NL"
  | "YT"
  | "NT"
  | "NU";

export type ProvinceDef = {
  code: ProvinceCode;
  name: string;

  // Newer code may use `enabled`
  enabled: boolean;

  // Older code may still expect `launchEnabled`
  launchEnabled: boolean;
};

export const PROVINCES: ProvinceDef[] = [
  { code: "BC", name: "British Columbia", enabled: false, launchEnabled: false },
  { code: "AB", name: "Alberta", enabled: true, launchEnabled: true },
  { code: "SK", name: "Saskatchewan", enabled: false, launchEnabled: false },
  { code: "MB", name: "Manitoba", enabled: false, launchEnabled: false },
  { code: "ON", name: "Ontario", enabled: false, launchEnabled: false },
  { code: "QC", name: "Quebec", enabled: false, launchEnabled: false },
  { code: "NB", name: "New Brunswick", enabled: false, launchEnabled: false },
  { code: "NS", name: "Nova Scotia", enabled: false, launchEnabled: false },
  { code: "PE", name: "Prince Edward Island", enabled: false, launchEnabled: false },
  { code: "NL", name: "Newfoundland and Labrador", enabled: false, launchEnabled: false },
  { code: "YT", name: "Yukon", enabled: false, launchEnabled: false },
  { code: "NT", name: "Northwest Territories", enabled: false, launchEnabled: false },
  { code: "NU", name: "Nunavut", enabled: false, launchEnabled: false },
];

function norm(code?: string | null) {
  return String(code || "").toUpperCase().trim();
}

export function provinceName(code?: string | null) {
  const up = norm(code);
  const found = PROVINCES.find((p) => p.code === up);
  return found ? found.name : up || "Unknown";
}

// Some files used provinceLabel()
export const provinceLabel = provinceName;

export function isProvinceEnabled(code?: string | null) {
  const up = norm(code);
  const found = PROVINCES.find((p) => p.code === up);
  // accept either flag (they are kept identical in PROVINCES)
  return !!(found?.enabled ?? found?.launchEnabled);
}

// Some files used isProvinceLaunchEnabled()
export const isProvinceLaunchEnabled = isProvinceEnabled;

export const ENABLED_PROVINCES = PROVINCES.filter((p) => p.enabled || p.launchEnabled).map((p) => p.code);
