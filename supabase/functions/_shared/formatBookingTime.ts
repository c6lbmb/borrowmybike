export function timezoneForProvince(province?: string | null) {
  switch ((province || "").toUpperCase()) {
    case "BC":
      return "America/Vancouver";
    case "AB":
      return "America/Edmonton";
    case "SK":
      return "America/Regina";
    case "MB":
      return "America/Winnipeg";
    case "ON":
    case "QC":
      return "America/Toronto";
    case "NB":
    case "NS":
    case "PE":
      return "America/Halifax";
    case "NL":
      return "America/St_Johns";
    default:
      return "America/Edmonton";
  }
}

export function formatBookingTime(
  iso?: string | null,
  province?: string | null
) {
  if (!iso) return "your upcoming road test";

  return new Date(iso).toLocaleString("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezoneForProvince(province),
  });
}