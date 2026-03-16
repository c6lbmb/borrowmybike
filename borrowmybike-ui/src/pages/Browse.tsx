// src/pages/Browse.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { sb } from "../lib/supabase";
import { PROVINCES, provinceLabel, isProvinceEnabled, type ProvinceCode } from "../lib/provinces";
import { getLaunchCityOptions, getMetroCities } from "../utils/metroAreas";
import { trackEvent } from "../lib/analytics";

type BikeRow = {
  id: string;
  owner_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_size: number | null;
  city: string | null;
  province: ProvinceCode | null;
  is_active: boolean | null;
};

type ReviewAgg = {
  bike_id: string;
  bike_rating: number | null;
};

type OwnerSummary = {
  id: string;
  first_name: string | null;
  years_riding: number | null;
  travel_quadrants: string[] | null;
  base_city?: string | null;
  service_cities?: string[] | null;
  available_weekdays?: boolean | null;
  available_weekends?: boolean | null;
  available_morning?: boolean | null;
  available_afternoon?: boolean | null;
  available_evening?: boolean | null;
  advance_notice_hours?: number | null;
  availability_notes?: string | null;
};

const BUCKET = "bike-photos";
type ProvinceFilter = "All" | ProvinceCode;

function coverUrl(ownerId: string, bikeId: string) {
  const path = `${ownerId}/${bikeId}/cover.webp`;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function titleOf(b: BikeRow) {
  const parts = [b.year ? String(b.year) : "", b.make || "", b.model || ""].filter(Boolean);
  return parts.length ? parts.join(" ") : "Bike";
}

function shortMeta(b: BikeRow) {
  const city = b.city || "—";
  const prov = provinceLabel(b.province) || "—";
  return `${city}, ${prov}`;
}

function formatRating(avg: number) {
  const rounded = Math.round(avg * 10) / 10;
  return rounded.toFixed(1);
}

function stars(avg: number) {
  const rounded = Math.round(avg);
  const full = Math.max(0, Math.min(5, rounded));
  return "★★★★★☆☆☆☆☆".slice(5 - full, 10 - full);
}

function normalizeCity(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function dedupeCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function formatServiceCities(owner: OwnerSummary) {
  const cities = dedupeCaseInsensitive(
    Array.isArray(owner.service_cities) ? owner.service_cities.filter(Boolean) : [],
  );

  if (!cities.length) return "";

  if (cities.length <= 3) return cities.join(" • ");

  return `${cities.slice(0, 3).join(" • ")} +${cities.length - 3} more`;
}

function formatAvailability(owner: OwnerSummary) {
  const dayParts: string[] = [];
  const timeParts: string[] = [];

  if (owner.available_weekdays) dayParts.push("Weekdays");
  if (owner.available_weekends) dayParts.push("Weekends");

  if (owner.available_morning) timeParts.push("Mornings");
  if (owner.available_afternoon) timeParts.push("Afternoons");
  if (owner.available_evening) timeParts.push("Evenings");

  const dayText = dayParts.length ? dayParts.join(" & ") : "";
  const timeText = timeParts.length ? timeParts.join(" • ") : "";

  if (dayText && timeText) return `${dayText} • ${timeText}`;
  if (dayText) return dayText;
  if (timeText) return timeText;
  return "";
}

function formatAdvanceNotice(hours: number | null | undefined) {
  if (hours == null || !Number.isFinite(hours)) return "";
  if (hours === 0) return "Same day okay";
  if (hours === 12) return "12h notice";
  if (hours === 24) return "24h notice";
  if (hours === 48) return "48h notice";
  if (hours === 72) return "3 days notice";
  if (hours === 168) return "1 week notice";
  if (hours % 24 === 0) return `${hours / 24} days notice`;
  return `${hours}h notice`;
}

function isUsefulNote(value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text) return false;
  if (text.toLowerCase() === "test") return false;
  if (text.length < 12) return false;
  return true;
}

export default function Browse() {
  const [bikes, setBikes] = useState<BikeRow[]>([]);
  const [reviews, setReviews] = useState<ReviewAgg[]>([]);
  const [ownerSummaries, setOwnerSummaries] = useState<Record<string, OwnerSummary>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [province, setProvince] = useState<ProvinceFilter>("All");
  const [city, setCity] = useState("All");
  const [activeOnly, setActiveOnly] = useState(true);
  const [didTrackBrowseView, setDidTrackBrowseView] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const p = (params.get("province") || "").toUpperCase();
      const c = params.get("city") || "";

      if (p) {
        const valid = PROVINCES.some((x) => x.code === p);
        if (valid) setProvince(p as ProvinceFilter);
      }

      if (c) {
        setCity(c);
      }
    } catch {
      // ignore malformed query params
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);

      const sel = "id, owner_id, make, model, year, engine_size, city, province, is_active";
      let q = sb.from("bikes").select(sel).limit(1000);
      if (activeOnly) q = q.eq("is_active", true);

      const [bRes, rRes] = await Promise.all([
        q,
        sb.from("reviews").select("bike_id,bike_rating").limit(4000),
      ]);

      if (cancelled) return;

      if (bRes.error) {
        setErr(bRes.error.message);
        setBikes([]);
      } else {
        const bikeRows = (((bRes.data as BikeRow[]) || []) ?? []);
        setBikes(bikeRows);

        try {
          const ownerIds = Array.from(new Set(bikeRows.map((x) => x.owner_id).filter(Boolean)));
          if (ownerIds.length) {
            const fnRes = await sb.functions.invoke("get-owner-summaries", {
              body: { owner_ids: ownerIds },
            });

            const owners = (fnRes.data?.owners || fnRes.data || []) as OwnerSummary[];
            const map: Record<string, OwnerSummary> = {};
            for (const o of owners || []) {
              if (o?.id) map[o.id] = o;
            }
            setOwnerSummaries(map);
          } else {
            setOwnerSummaries({});
          }
        } catch (e) {
          console.error(e);
          setOwnerSummaries({});
        }
      }

      if (rRes.error) {
        console.error(rRes.error);
        setReviews([]);
      } else {
        setReviews(((rRes.data as ReviewAgg[]) || []) ?? []);
      }

      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [activeOnly]);

  const ratingByBikeId = useMemo(() => {
    const map = new Map<string, { sum: number; count: number }>();
    for (const r of reviews) {
      const v = r.bike_rating ?? null;
      if (!r.bike_id || v == null) continue;
      const cur = map.get(r.bike_id) || { sum: 0, count: 0 };
      cur.sum += v;
      cur.count += 1;
      map.set(r.bike_id, cur);
    }
    return map;
  }, [reviews]);

  const cityOptions = useMemo(() => {
    if (province === "AB") {
      return ["All", ...getLaunchCityOptions("AB")];
    }

    const s = new Set<string>();
    for (const b of bikes) {
      if (!b.city) continue;
      if (province !== "All" && b.province !== province) continue;
      s.add(b.city);
    }
    return ["All", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [bikes, province]);

  useEffect(() => {
    if (city === "All") return;
    if (!cityOptions.includes(city)) setCity("All");
  }, [province, cityOptions, city]);

  const metroCities = useMemo(() => {
    if (city === "All") return [];
    return getMetroCities(city).map((c) => c.toLowerCase());
  }, [city]);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = bikes.filter((b) => {
      if (province !== "All" && b.province !== province) return false;

      if (city !== "All") {
        const bikeCity = normalizeCity(b.city);
        if (!metroCities.includes(bikeCity)) return false;
      }

      if (!q) return true;

      const owner = ownerSummaries[b.owner_id];
      const ownerHay = owner
        ? [
            owner.first_name || "",
            owner.base_city || "",
            ...(owner.service_cities || []),
            owner.availability_notes || "",
          ].join(" ")
        : "";

      const hay =
        `${b.make || ""} ${b.model || ""} ${b.year || ""} ${b.city || ""} ${b.province || ""} ${ownerHay}`.toLowerCase();

      return hay.includes(q);
    });

    const wantProvince = province !== "All" ? province : null;
    const wantCity = city !== "All" ? normalizeCity(city) : null;

    function bucket(b: BikeRow) {
      const bikeCity = normalizeCity(b.city);
      const exactCity = !!wantCity && bikeCity === wantCity;
      const metroMatch = !!wantCity && metroCities.includes(bikeCity);

      if (wantProvince && wantCity) {
        if (b.province === wantProvince && exactCity) return 0;
        if (b.province === wantProvince && metroMatch) return 1;
        if (b.province === wantProvince) return 2;
        return 3;
      }
      if (wantProvince) return b.province === wantProvince ? 0 : 1;
      if (wantCity) {
        if (exactCity) return 0;
        if (metroMatch) return 1;
        return 2;
      }
      return 0;
    }

    return filtered.sort((a, b) => {
      const ba = bucket(a);
      const bb = bucket(b);
      if (ba !== bb) return ba - bb;

      const ra = ratingByBikeId.get(a.id);
      const rb = ratingByBikeId.get(b.id);
      const avga = ra && ra.count ? ra.sum / ra.count : -1;
      const avgb = rb && rb.count ? rb.sum / rb.count : -1;
      if (avga !== avgb) return avgb - avga;

      return titleOf(a).localeCompare(titleOf(b));
    });
  }, [bikes, search, city, province, ratingByBikeId, metroCities, ownerSummaries]);

  useEffect(() => {
    if (loading || didTrackBrowseView) return;

    trackEvent("browse_page_viewed", {
      province_filter: province,
      city_filter: city,
      active_only: activeOnly,
      listing_count: filteredAndSorted.length,
      search_query_present: !!search.trim(),
    });
    setDidTrackBrowseView(true);
  }, [loading, didTrackBrowseView, province, city, activeOnly, filteredAndSorted.length, search]);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "10px 0" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Browse bikes</h1>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 750 }}>
            Find road-test-ready bikes in your area. Major city searches include nearby surrounding communities.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            to="/mentors/start"
            style={{
              textDecoration: "none",
              fontWeight: 950,
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "white",
            }}
          >
            List your bike
          </Link>
        </div>
      </div>

      {err && (
        <div
          style={{
            marginTop: 12,
            background: "#fff2f2",
            border: "1px solid #ffd6d6",
            color: "#b42318",
            padding: 12,
            borderRadius: 12,
            fontWeight: 800,
          }}
        >
          Error: {err}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          background: "#fff",
          border: "1px solid #e8edf6",
          borderRadius: 18,
          padding: 14,
        }}
      >
        <div
          className="browseFilters"
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>
              Search
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Make, model, year, city…"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #d7deea",
                outline: "none",
                fontWeight: 700,
              }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>
              Province
            </div>
            <select
              value={province}
              onChange={(e) => setProvince(e.target.value as ProvinceFilter)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #d7deea",
                outline: "none",
                background: "#fff",
                fontWeight: 800,
              }}
            >
              <option value="All">All</option>
              {PROVINCES.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                  {!isProvinceEnabled(p.code) ? " (coming soon)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>
              City
            </div>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid #d7deea",
                outline: "none",
                background: "#fff",
                fontWeight: 800,
              }}
            >
              {cityOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>
              Active only
            </div>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Yes
            </label>
          </div>
        </div>

        <style>{`
          @media (max-width: 900px) {
            .browseFilters { grid-template-columns: 1fr 1fr !important; }
          }
          @media (max-width: 560px) {
            .browseFilters { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>

      <div style={{ marginTop: 12, color: "#64748b", fontWeight: 750, fontSize: 13 }}>
        {filteredAndSorted.length} bike(s)
        {city !== "All" ? ` near ${city}` : ""}
        {province !== "All" ? ` in ${provinceLabel(province)}` : ""}
      </div>

      {loading ? (
        <div style={{ marginTop: 14, color: "#4b5563", fontWeight: 700 }}>Loading…</div>
      ) : filteredAndSorted.length === 0 ? (
        <div
          style={{
            marginTop: 14,
            background: "#fff",
            border: "1px solid #e8edf6",
            borderRadius: 18,
            padding: 16,
            color: "#0f172a",
            fontWeight: 850,
          }}
        >
          No bikes listed here yet.
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 750 }}>
            We’re expanding across Alberta. If you have a road-test-ready bike, you can be one of the first mentors in this area and earn about $100 per road test.
          </div>
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 18,
          }}
        >
          {filteredAndSorted.map((b) => {
            const img = coverUrl(b.owner_id, b.id);
            const agg = ratingByBikeId.get(b.id);
            const avg = agg && agg.count ? agg.sum / agg.count : null;
            const owner = ownerSummaries[b.owner_id];
            const bookingEnabled = b.province ? isProvinceEnabled(b.province) : false;

            const mentorName = (owner?.first_name || "").trim();
            const mentorYears =
              owner?.years_riding != null && Number.isFinite(owner.years_riding)
                ? `${owner.years_riding} yrs riding`
                : "";

            const serviceCitiesText = owner ? formatServiceCities(owner) : "";
            const availabilityText = owner ? formatAvailability(owner) : "";
            const noticeText = owner ? formatAdvanceNotice(owner.advance_notice_hours) : "";
            const notesText = (owner?.availability_notes || "").trim();
            const showNotes = isUsefulNote(notesText);

            return (
              <Link
                key={b.id}
                to={`/bikes/${b.id}`}
                onClick={() => {
                  trackEvent("bike_card_clicked", {
                    bike_id: b.id,
                    bike_title: titleOf(b),
                    province: b.province || "",
                    city: b.city || "",
                    booking_enabled: bookingEnabled,
                    has_reviews: avg != null,
                  });
                }}
                style={{
                  textDecoration: "none",
                  color: "inherit",
                  background: "#fff",
                  border: "1px solid #e8edf6",
                  borderRadius: 18,
                  overflow: "hidden",
                  display: "block",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
                  transition: "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 14px 30px rgba(0,0,0,0.08)";
                  e.currentTarget.style.borderColor = "rgba(15,23,42,0.16)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.04)";
                  e.currentTarget.style.borderColor = "#e8edf6";
                }}
              >
                <div style={{ width: "100%", height: 180, background: "#eef2f8", position: "relative" }}>
                  <img
                    src={img}
                    alt="Bike"
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />

                  {!bookingEnabled && b.province ? (
                    <div
                      style={{
                        position: "absolute",
                        left: 12,
                        top: 12,
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid #fed7aa",
                        background: "rgba(255,247,237,0.95)",
                        color: "#7c2d12",
                        fontWeight: 950,
                        fontSize: 12,
                      }}
                    >
                      Booking coming soon
                    </div>
                  ) : null}
                </div>

                <div style={{ padding: 15 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "baseline",
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 950, color: "#0f172a" }}>{titleOf(b)}</div>

                    {avg == null ? (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 950,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: "1px solid rgba(2,132,199,0.18)",
                          background: "rgba(2,132,199,0.08)",
                          color: "#075985",
                          whiteSpace: "nowrap",
                        }}
                      >
                        New
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 950,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: "1px solid rgba(15,23,42,0.12)",
                          background: "rgba(15,23,42,0.04)",
                          color: "#0f172a",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {stars(avg)} {formatRating(avg)} ({agg?.count || 0})
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>{shortMeta(b)}</div>

                 {owner ? (
  <div
    style={{
      marginTop: 10,
      padding: 12,
      borderRadius: 14,
      border: "none",
      background: "#fbfdff",
    }}
  >
    <div style={{ color: "#0f172a", fontWeight: 950, fontSize: 15 }}>
      {mentorName || "Mentor"}
    </div>

    <div style={{ marginTop: 2, color: "#64748b", fontWeight: 800, fontSize: 12 }}>
     {mentorYears ? `${mentorYears} riding` : "Mentor"}
    </div>

    {serviceCitiesText ? (
      <div style={{ marginTop: 10 }}>
        <div
          style={{
            color: "#64748b",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".03em",
          }}
        >
          Serves
        </div>
        <div style={{ marginTop: 2, color: "#1e293b", fontWeight: 750, fontSize: 13, lineHeight: 1.4 }}>
          {serviceCitiesText}
        </div>
      </div>
    ) : null}

    {availabilityText ? (
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            color: "#64748b",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".03em",
          }}
        >
          Available
        </div>
        <div style={{ marginTop: 2, color: "#334155", fontWeight: 750, fontSize: 13, lineHeight: 1.4 }}>
          {availabilityText}
        </div>
      </div>
    ) : null}

    {noticeText ? (
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            color: "#64748b",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".03em",
          }}
        >
          Notice
        </div>
        <div style={{ marginTop: 2, color: "#334155", fontWeight: 750, fontSize: 13 }}>
          {noticeText}
        </div>
      </div>
    ) : null}

    {Array.isArray(owner.travel_quadrants) && owner.travel_quadrants.length ? (
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            color: "#94a3b8",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: ".03em",
          }}
        >
          Comfort zones
        </div>
        <div style={{ marginTop: 2, color: "#64748b", fontWeight: 700, fontSize: 12 }}>
          {owner.travel_quadrants.join(" • ")}
        </div>
      </div>
    ) : null}

    {showNotes ? (
      <div
        style={{
          marginTop: 10,
          paddingTop: 8,
          borderTop: "1px solid #e2e8f0",
          color: "#64748b",
          fontWeight: 750,
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        {notesText}
      </div>
    ) : null}
  </div>
) : null}

                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ color: "#475569", fontWeight: 800, fontSize: 13 }}>
                      {b.is_active ? "Active listing" : "Inactive"}
                    </div>

                    <div
                      style={{
                        fontWeight: 950,
                        color: "#0f172a",
                        fontSize: 13,
                      }}
                    >
                      View details →
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}