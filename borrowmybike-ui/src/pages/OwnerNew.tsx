// src/pages/OwnerNew.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { PROVINCES, type ProvinceCode } from "../lib/provinces";

type Bike = {
  id: string;
  owner_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  city: string | null;
  province: ProvinceCode | null;
  is_active: boolean;
};

const BUCKET = "bike-photos";

// Cache-bust helper (forces UI to load newest cover.webp after replacing file at same path)
function coverVersionKey(bikeId: string) {
  return `bike_cover_v_${bikeId}`;
}
function getCoverVersion(bikeId: string) {
  try {
    return sessionStorage.getItem(coverVersionKey(bikeId)) || "";
  } catch {
    return "";
  }
}
function bumpCoverVersion(bikeId: string) {
  try {
    sessionStorage.setItem(coverVersionKey(bikeId), String(Date.now()));
  } catch {
    // ignore
  }
}
function coverUrl(ownerId: string, bikeId: string) {
  const path = `${ownerId}/${bikeId}/cover.webp`;
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  const v = getCoverVersion(bikeId);
  return v ? `${data.publicUrl}?v=${v}` : data.publicUrl;
}

async function fileToWebp(file: File, maxW = 1400, maxH = 1400, quality = 0.82): Promise<Blob> {
  const img = await createImageBitmap(file);

  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  ctx.drawImage(img, 0, 0, w, h);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to encode WebP"))), "image/webp", quality);
  });

  return blob;
}

export default function OwnerNew() {
  const nav = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? null;

  const [bike, setBike] = useState<Bike | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState<string>("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState<string>(""); // force selection
  const [active, setActive] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const cover = useMemo(() => {
    if (!bike || !me) return null;
    return coverUrl(me, bike.id);
  }, [bike, me]);

  useEffect(() => {
    if (!me) return;

    (async () => {
      setLoading(true);
      setErr(null);

      const res = await sb
        .from("bikes")
        .select("id, owner_id, make, model, year, city, province, is_active")
        .eq("owner_id", me)
        .limit(1)
        .maybeSingle();

      if (res.error) {
        setErr(res.error.message);
        setBike(null);
        setLoading(false);
        return;
      }

      const b = (res.data as Bike | null) || null;
      setBike(b);

      if (b) {
        setMake(b.make || "");
        setModel(b.model || "");
        setYear(b.year ? String(b.year) : "");
        setCity(b.city || "");
        setProvince(b.province || "");
        setActive(!!b.is_active);
      } else {
        // no bike yet -> force province selection before save
        setProvince("");
      }

      setLoading(false);
    })();
  }, [me]);

  function onPickFile(f: File | null) {
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  function validateProvinceOrThrow() {
    // ✅ Option A: allow listing in ALL provinces. Only require selection.
    if (!province) {
      throw new Error("Please select a province.");
    }
  }

  async function ensureBikeRow(): Promise<Bike> {
    if (!me) throw new Error("Not signed in");

    validateProvinceOrThrow();

    // If already exists, return it
    if (bike) return bike;

    // Otherwise create a placeholder row (one bike per owner for MVP)
    const insertRes = await sb
      .from("bikes")
      .insert({
        owner_id: me,
        make: make || null,
        model: model || null,
        year: year ? Number(year) : null,
        city: city || null,
        province: province as ProvinceCode,
        is_active: active,
      })
      .select("id, owner_id, make, model, year, city, province, is_active")
      .single();

    if (insertRes.error) throw insertRes.error;

    const created = insertRes.data as Bike;
    setBike(created);
    return created;
  }

  async function uploadCover(ownerId: string, bikeId: string, f: File) {
    setUploading(true);
    setErr(null);

    const webp = await fileToWebp(f);

    const path = `${ownerId}/${bikeId}/cover.webp`;

    const up = await sb.storage.from(BUCKET).upload(path, webp, {
      contentType: "image/webp",
      upsert: true,
    });

    if (up.error) {
      setUploading(false);
      throw up.error;
    }

    bumpCoverVersion(bikeId);
    setUploading(false);
  }

  async function save() {
    try {
      if (!me) {
        setErr("Please sign in first.");
        return;
      }

      setSaving(true);
      setErr(null);

      validateProvinceOrThrow();

      const b = await ensureBikeRow();

      const upd = await sb
        .from("bikes")
        .update({
          make: make || null,
          model: model || null,
          year: year ? Number(year) : null,
          city: city || null,
          province: province as ProvinceCode,
          is_active: active,
        })
        .eq("id", b.id);

      if (upd.error) throw upd.error;

      if (file) {
        await uploadCover(me, b.id, file);
        onPickFile(null);
      }

      const reload = await sb
        .from("bikes")
        .select("id, owner_id, make, model, year, city, province, is_active")
        .eq("owner_id", me)
        .limit(1)
        .maybeSingle();

      if (!reload.error) {
        setBike((reload.data as Bike | null) || null);
      }

      setSaving(false);
      nav("/dashboard/mentor");
    } catch (e: any) {
      setSaving(false);
      setUploading(false);
      setErr(e?.message || "Save failed");
    }
  }

  const page: React.CSSProperties = { padding: "2rem" };

  const card: React.CSSProperties = {
    marginTop: 14,
    padding: 14,
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    background: "white",
  };

  const btn: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #cbd5e1",
    fontWeight: 900,
    cursor: "pointer",
    background: "white",
    color: "#0f172a",
    textDecoration: "none",
    display: "inline-block",
  };

  const btnPrimary: React.CSSProperties = {
    ...btn,
    background: "#0f172a",
    borderColor: "#0f172a",
    color: "white",
  };

  if (!me) {
    return (
      <div style={page}>
        <h1 style={{ margin: 0 }}>Edit bike</h1>
        <div style={{ marginTop: 8, color: "#64748b", fontWeight: 800 }}>Please sign in first.</div>
        <div style={{ marginTop: 12 }}>
          <Link to="/auth" style={btnPrimary}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Edit bike</h1>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>
            Province is required. Mentors can list bikes anywhere in Canada — booking opens province-by-province.
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Link to="/dashboard/mentor" style={btn}>
            ← Mentor dashboard
          </Link>
          <Link to="/browse" style={btn}>
            Browse
          </Link>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #fecaca", background: "#fff1f2" }}>
          <div style={{ fontWeight: 900, color: "#b00020" }}>Error</div>
          <div style={{ marginTop: 6, color: "#7f1d1d", fontWeight: 800 }}>{err}</div>
        </div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 1000, fontSize: 16 }}>
          {bike ? `${bike.year || ""} ${bike.make || ""} ${bike.model || ""}`.trim() || "Your bike" : "Your bike"}
        </div>
        <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>This is what borrowers will see. Keep it accurate.</div>

        {loading ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 800 }}>Loading…</div>
        ) : (
          <>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Make</div>
                <input value={make} onChange={(e) => setMake(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }} />
              </div>

              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Model</div>
                <input value={model} onChange={(e) => setModel(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }} />
              </div>

              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>Year</div>
                <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }} />
              </div>

              <div>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>City</div>
                <input value={city} onChange={(e) => setCity(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }} />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                  Province <span style={{ color: "#b00020" }}>*</span>
                </div>
                <select
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0", background: "white", fontWeight: 800 }}
                >
                  <option value="" disabled>
                    Select province…
                  </option>
                  {PROVINCES.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                      {!p.launchEnabled ? " (coming soon)" : ""}
                    </option>
                  ))}
                </select>

                <div style={{ marginTop: 8, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
                  You can list in any province. If your province is marked “coming soon”, borrowers will see the listing but booking will be disabled until launch.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} id="active" />
              <label htmlFor="active" style={{ fontWeight: 900 }}>
                Active listing (show in Browse)
              </label>
            </div>

            <hr style={{ marginTop: 14, border: "none", borderTop: "1px solid #e2e8f0" }} />

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 1000 }}>Cover photo</div>
              <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800 }}>
                One photo for MVP. We compress to WebP before upload to keep storage cheap.
              </div>

              <div
                style={{
                  marginTop: 10,
                  width: 320,
                  maxWidth: "100%",
                  aspectRatio: "4 / 3",
                  borderRadius: 14,
                  overflow: "hidden",
                  border: "1px solid #e2e8f0",
                  background: "#f1f5f9",
                }}
              >
                {previewUrl ? (
                  <img src={previewUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : bike && cover ? (
                  <img src={cover} alt="Cover" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#64748b", fontWeight: 900 }}>
                    No photo yet
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <input type="file" accept="image/*" onChange={(e) => onPickFile(e.target.files?.[0] || null)} />
              </div>

              {uploading && <div style={{ marginTop: 8, color: "#64748b", fontWeight: 800 }}>Uploading photo…</div>}
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={save} disabled={saving || uploading} style={btnPrimary}>
                {saving ? "Saving…" : "Save"}
              </button>

              <Link to="/dashboard/mentor" style={btn}>
                Cancel
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
