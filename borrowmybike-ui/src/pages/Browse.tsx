// src/pages/Browse.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { sb } from "../lib/supabase";
import { PROVINCES, provinceLabel, isProvinceEnabled, type ProvinceCode } from "../lib/provinces";

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

export default function Browse() {
  const [bikes, setBikes] = useState<BikeRow[]>([]);
  const [reviews, setReviews] = useState<ReviewAgg[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [province, setProvince] = useState<ProvinceFilter>("All");
  const [city, setCity] = useState("All");
  const [activeOnly, setActiveOnly] = useState(true);

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
        // ✅ Show bikes in ALL provinces (owner-first Canada-wide)
        setBikes(((bRes.data as BikeRow[]) || []) ?? []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [province, cityOptions.join("|")]);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = bikes.filter((b) => {
      if (province !== "All" && b.province !== province) return false;
      if (city !== "All" && (b.city || "") !== city) return false;

      if (!q) return true;

      const hay = `${b.make || ""} ${b.model || ""} ${b.year || ""} ${b.city || ""} ${b.province || ""}`.toLowerCase();
      return hay.includes(q);
    });

    // Prefer matching filters first, then rating, then title
    const wantProvince = province !== "All" ? province : null;
    const wantCity = city !== "All" ? city : null;

    function bucket(b: BikeRow) {
      if (wantProvince && wantCity) {
        if (b.province === wantProvince && (b.city || "") === wantCity) return 0;
        if (b.province === wantProvince) return 1;
        return 2;
      }
      if (wantProvince) return b.province === wantProvince ? 0 : 1;
      if (wantCity) return (b.city || "") === wantCity ? 0 : 1;
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
  }, [bikes, search, city, province, ratingByBikeId]);

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "10px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Browse bikes</h1>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 750 }}>
            Owners can list Canada-wide. Booking opens province-by-province.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link
            to="/owners/start"
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

      {/* Filters */}
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
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>Search</div>
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
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>Province</div>
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
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>City</div>
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
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6, color: "#0f172a" }}>Active only</div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800, color: "#0f172a" }}>
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
          No bikes match your filters.
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 750 }}>
            Try a different province/city, or clear the search.
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {filteredAndSorted.map((b) => {
            const img = coverUrl(b.owner_id, b.id);
            const agg = ratingByBikeId.get(b.id);
            const avg = agg && agg.count ? agg.sum / agg.count : null;

            const bookingEnabled = b.province ? isProvinceEnabled(b.province) : false;

            return (
              <Link
                key={b.id}
                to={`/bikes/${b.id}`}
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
                  (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-1px)";
                  (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 14px 30px rgba(0,0,0,0.08)";
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(15,23,42,0.16)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
                  (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.04)";
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "#e8edf6";
                }}
              >
                <div style={{ width: "100%", height: 180, background: "#eef2f8", position: "relative" }}>
                  <img
                    src={img}
                    alt="Bike"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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

                <div style={{ padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
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

                  <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>
                    {shortMeta(b)}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
