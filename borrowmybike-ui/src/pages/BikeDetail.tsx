// src/pages/BikeDetail.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { sb } from "../lib/supabase";
import { isProvinceEnabled, provinceLabel, type ProvinceCode } from "../lib/provinces";

type Bike = {
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

type Review = {
  id: string;
  booking_id: string;
  borrower_id: string;
  owner_id: string;
  bike_id: string;
  owner_rating: number | null;
  bike_rating: number | null;
  comment: string | null;
  created_at: string | null;
};


type OwnerSummary = {
  id: string;
  first_name: string | null;
  years_riding: number | null;
  travel_quadrants: string[] | null;
};

const BUCKET = "bike-photos";

function coverUrl(ownerId: string, bikeId: string) {
  const path = `${ownerId}/${bikeId}/cover.webp`;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function titleOf(b: Bike) {
  const year = b.year ? `${b.year} ` : "";
  const make = b.make ? `${b.make} ` : "";
  const model = b.model ? `${b.model}` : "";
  const t = `${year}${make}${model}`.trim();
  return t || "Bike";
}

export default function BikeDetail() {
  const { id } = useParams();
  const [bike, setBike] = useState<Bike | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [owner, setOwner] = useState<OwnerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!id) return;

      setLoading(true);
      setErr(null);

      const b = await sb
        .from("bikes")
        .select("id, owner_id, make, model, year, engine_size, city, province, is_active")
        .eq("id", id)
        .single();

      if (b.error) {
        if (!cancelled) {
          setErr(b.error.message);
          setLoading(false);
        }
        return;
      }

      const r = await sb
        .from("reviews")
        .select("id,booking_id,borrower_id,owner_id,bike_id,owner_rating,bike_rating,comment,created_at")
        .eq("bike_id", id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (!cancelled) {
        setBike((b.data as Bike) || null);

        // Load mentor summary for this bike
        try {
          const ownerId = ((b.data as Bike) || null)?.owner_id;
          if (ownerId) {
            const fnRes = await sb.functions.invoke("get-owner-summaries", {
              body: { owner_ids: [ownerId] },
            });
            const owners = (fnRes.data?.owners || fnRes.data || []) as OwnerSummary[];
            const found = (owners || []).find((x) => x?.id === ownerId) || null;
            setOwner(found);
          } else {
            setOwner(null);
          }
        } catch (e) {
          console.error(e);
          setOwner(null);
        }
        setReviews(((r.data as Review[]) || []) ?? []);
        setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const avgBike = useMemo(() => {
    const vals = reviews.map((x) => x.bike_rating).filter((x): x is number => typeof x === "number");
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [reviews]);

  const avgOwner = useMemo(() => {
    const vals = reviews.map((x) => x.owner_rating).filter((x): x is number => typeof x === "number");
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }, [reviews]);

  if (loading) return <div style={{ color: "#4b5563" }}>Loading…</div>;

  if (err || !bike) {
    return (
      <div
        style={{
          background: "#fff2f2",
          border: "1px solid #ffd6d6",
          color: "#b42318",
          padding: 14,
          borderRadius: 14,
          fontWeight: 700,
        }}
      >
        {err ? `Error: ${err}` : "Bike not found"}
      </div>
    );
  }

  const bookingEnabled = bike.province ? isProvinceEnabled(bike.province) : false;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>{titleOf(bike)}</h1>
        {owner ? (
          <div style={{ marginTop: 6, color: "#334155", fontWeight: 850 }}>
            Mentor: {(owner.first_name || "—").trim()}{owner.years_riding != null ? ` • ${owner.years_riding} yrs riding` : ""}
            {Array.isArray(owner.travel_quadrants) && owner.travel_quadrants.length ? (
              <div style={{ marginTop: 2, color: "#64748b", fontWeight: 800 }}>
                Will travel: {owner.travel_quadrants.join(", ")}
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link to="/browse" style={{ fontWeight: 800, textDecoration: "none" }}>
            ← Back to Browse
          </Link>

          {bookingEnabled ? (
            <Link
              to={`/bikes/${bike.id}/request`}
              style={{
                fontWeight: 900,
                textDecoration: "none",
                background: "#0b1220",
                color: "#fff",
                padding: "10px 14px",
                borderRadius: 12,
              }}
            >
              Request booking
            </Link>
          ) : (
            <div
              style={{
                fontWeight: 900,
                background: "#fff7ed",
                color: "#7c2d12",
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid #fed7aa",
              }}
              title="Booking is not enabled in this province yet"
            >
              Booking coming soon in {provinceLabel(bike.province) || "this province"}
            </div>
          )}
        </div>
      </div>

      {/* Cover image */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e8edf6",
          borderRadius: 18,
          overflow: "hidden",
        }}
      >
        <div style={{ width: "100%", height: 320, background: "#eef2f8" }}>
          <img
            src={coverUrl(bike.owner_id, bike.id)}
            alt="Bike cover"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </div>
      </div>

      {/* Details */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e8edf6",
          borderRadius: 18,
          padding: 16,
        }}
      >
        <h2 style={{ margin: "0 0 10px 0" }}>Bike details</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <div style={{ border: "1px solid #eef2f8", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#4b5563" }}>Make</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{bike.make || "—"}</div>
          </div>

          <div style={{ border: "1px solid #eef2f8", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#4b5563" }}>Model</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{bike.model || "—"}</div>
          </div>

          <div style={{ border: "1px solid #eef2f8", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#4b5563" }}>Year</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{bike.year ?? "—"}</div>
          </div>

          <div style={{ border: "1px solid #eef2f8", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#4b5563" }}>Engine size</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>
              {bike.engine_size ? `${bike.engine_size} cc` : "—"}
            </div>
          </div>

          <div style={{ border: "1px solid #eef2f8", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#4b5563" }}>City</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{bike.city || "—"}</div>
          </div>

          <div style={{ border: "1px solid #eef2f8", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#4b5563" }}>Province</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{provinceLabel(bike.province) || "—"}</div>
          </div>

          <div style={{ border: "1px solid #eef2f8", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#4b5563" }}>Listing status</div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>{bike.is_active ? "Active" : "Inactive"}</div>
          </div>
        </div>

        <div style={{ marginTop: 10, color: "#4b5563", fontSize: 12, fontWeight: 700 }}>
          Note: VIN / plate / insurance / registration details are kept private and are not shown to borrowers.
        </div>
      </div>

      {/* Reviews */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e8edf6",
          borderRadius: 18,
          padding: 16,
        }}
      >
        <h2 style={{ margin: "0 0 10px 0" }}>Reviews</h2>

        <div style={{ color: "#4b5563", fontWeight: 800, marginBottom: 10 }}>
          Bike: {avgBike == null ? "New" : `${avgBike.toFixed(1)}/5`} • Mentor: {avgOwner == null ? "New" : `${avgOwner.toFixed(1)}/5`}
        </div>

        {reviews.length === 0 ? (
          <div style={{ color: "#4b5563" }}>No reviews yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {reviews.map((r) => (
              <div
                key={r.id}
                style={{
                  border: "1px solid #eef2f8",
                  borderRadius: 14,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  Bike: {r.bike_rating ?? "—"}/5 • Mentor: {r.owner_rating ?? "—"}/5
                </div>
                <div style={{ color: "#0b1220", fontWeight: 700 }}>{r.comment || "—"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
