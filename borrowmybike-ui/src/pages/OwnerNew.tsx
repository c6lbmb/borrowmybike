// src/pages/OwnerNew.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sb } from "../lib/supabase";
import { useAuth } from "../auth/useAuth";
import { PROVINCES, type ProvinceCode } from "../lib/provinces";
import { callFn } from "../lib/fn";
import { getBaseCityOptions, getServiceCitiesForBaseCity } from "../utils/metroAreas";

type Bike = {
  id: string;
  owner_id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine_size: number | null;
  city: string | null;
  province: ProvinceCode | null;
  is_active: boolean;
};

type OwnerSummary = {
  id: string;
  first_name?: string | null;
  years_riding?: number | null;
  travel_quadrants?: string[] | null;
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
const QUADRANTS = ["NE", "NW", "SE", "SW"] as const;

const NOTICE_OPTIONS = [
  { value: "0", label: "Same day is okay" },
  { value: "12", label: "12 hours notice" },
  { value: "24", label: "24 hours notice" },
  { value: "48", label: "48 hours notice" },
  { value: "72", label: "3 days notice" },
  { value: "168", label: "1 week notice" },
];

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

function dedupeCaseInsensitive(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }

  return out;
}

function withoutBaseCity(values: string[], baseCity: string) {
  const base = baseCity.trim().toLowerCase();
  return dedupeCaseInsensitive(values).filter((x) => x.trim().toLowerCase() !== base);
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
  const [engineSize, setEngineSize] = useState<string>("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState<string>("");
  const [active, setActive] = useState(true);

  const [firstName, setFirstName] = useState("");
  const [yearsRiding, setYearsRiding] = useState<string>("");
  const [travelQuadrants, setTravelQuadrants] = useState<string[]>(["NE", "NW", "SE", "SW"]);
  const [baseCity, setBaseCity] = useState("");
  const [serviceCities, setServiceCities] = useState<string[]>([]);
  const [availableWeekdays, setAvailableWeekdays] = useState(false);
  const [availableWeekends, setAvailableWeekends] = useState(false);
  const [availableMorning, setAvailableMorning] = useState(false);
  const [availableAfternoon, setAvailableAfternoon] = useState(false);
  const [availableEvening, setAvailableEvening] = useState(false);
  const [advanceNoticeHours, setAdvanceNoticeHours] = useState<string>("24");
  const [availabilityNotes, setAvailabilityNotes] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const cover = useMemo(() => {
    if (!bike || !me) return null;
    return coverUrl(me, bike.id);
  }, [bike, me]);

  const baseCityOptions = useMemo(() => getBaseCityOptions("AB"), []);
  const serviceCityOptions = useMemo(() => getServiceCitiesForBaseCity(baseCity), [baseCity]);

  useEffect(() => {
    if (!me) return;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const prof = await callFn<{ owners: OwnerSummary[] }>("get-owner-summaries", {
          owner_ids: [me],
        });

        if (prof.ok && prof.data?.owners?.[0]) {
          const o = prof.data.owners[0];

          setFirstName(o.first_name ?? "");
          setYearsRiding(o.years_riding != null ? String(o.years_riding) : "");

          if (Array.isArray(o.travel_quadrants) && o.travel_quadrants.length) {
            setTravelQuadrants(o.travel_quadrants);
          }

          const loadedBaseCity = o.base_city ?? "";
          setBaseCity(loadedBaseCity);

          if (Array.isArray(o.service_cities)) {
            setServiceCities(withoutBaseCity(o.service_cities, loadedBaseCity));
          }

          setAvailableWeekdays(!!o.available_weekdays);
          setAvailableWeekends(!!o.available_weekends);
          setAvailableMorning(!!o.available_morning);
          setAvailableAfternoon(!!o.available_afternoon);
          setAvailableEvening(!!o.available_evening);
          setAdvanceNoticeHours(
            o.advance_notice_hours != null ? String(o.advance_notice_hours) : "24",
          );
          setAvailabilityNotes(o.availability_notes ?? "");
        }
      } catch {
        // ignore profile load errors
      }

      const res = await sb
        .from("bikes")
        .select("id, owner_id, make, model, year, engine_size, city, province, is_active")
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
        setEngineSize((b as Bike).engine_size != null ? String((b as Bike).engine_size) : "");
        setCity(b.city || "");
        setProvince(b.province || "");
        setActive(!!b.is_active);
      } else {
        setProvince("");
        setEngineSize("");
      }

      setLoading(false);
    })();
  }, [me]);

  useEffect(() => {
    if (!baseCity) {
      setServiceCities([]);
      return;
    }

    const allowed = new Set(getServiceCitiesForBaseCity(baseCity).map((c) => c.toLowerCase()));
    setServiceCities((prev) => prev.filter((city) => allowed.has(city.toLowerCase())));
  }, [baseCity]);

  function validateMentorProfileOrThrow() {
    const fn = firstName.trim();
    if (!fn) throw new Error("Please enter your first name.");

    const yrs = yearsRiding.trim() ? Number(yearsRiding.trim()) : null;
    if (yearsRiding.trim() && (!Number.isFinite(yrs) || yrs! < 0 || yrs! > 60)) {
      throw new Error("Years riding must be a number between 0 and 60.");
    }

    const base = baseCity.trim();
    if (!base) throw new Error("Please choose your base city.");

    const allowedServiceCities = getServiceCitiesForBaseCity(base);
    const allowedSet = new Set(allowedServiceCities.map((x) => x.toLowerCase()));
    const cleanedServiceCities = withoutBaseCity(serviceCities, base).filter((x) =>
      allowedSet.has(x.toLowerCase()),
    );

    if (!cleanedServiceCities.length) {
      throw new Error("Please select at least one nearby service city.");
    }

    if (!availableWeekdays && !availableWeekends) {
      throw new Error("Please choose whether you’re generally available on weekdays and/or weekends.");
    }

    if (!availableMorning && !availableAfternoon && !availableEvening) {
      throw new Error("Please choose at least one time of day you’re generally available.");
    }

    const notice = advanceNoticeHours.trim() ? Number(advanceNoticeHours.trim()) : null;
    if (notice === null || !Number.isFinite(notice) || notice < 0 || notice > 336) {
      throw new Error("Please choose a valid advance notice preference.");
    }

    if (!travelQuadrants.length) {
      throw new Error("Pick at least one quadrant you’re willing to travel to.");
    }
  }

  async function persistMentorProfile() {
    const fn = firstName.trim();
    const yrs = yearsRiding.trim() ? Number(yearsRiding.trim()) : null;
    const base = baseCity.trim();
    const cleanedServiceCities = withoutBaseCity(serviceCities, base);

    const res = await callFn("update-my-profile", {
      first_name: fn.slice(0, 50),
      years_riding: yrs,
      travel_quadrants: travelQuadrants,
      base_city: base.slice(0, 80),
      service_cities: cleanedServiceCities.map((x) => x.slice(0, 80)),
      available_weekdays: availableWeekdays,
      available_weekends: availableWeekends,
      available_morning: availableMorning,
      available_afternoon: availableAfternoon,
      available_evening: availableEvening,
      advance_notice_hours: Number(advanceNoticeHours),
      availability_notes: availabilityNotes.trim().slice(0, 500),
    });

    if (!res.ok) throw new Error(res.error || "Profile update failed");
    setServiceCities(cleanedServiceCities);
  }

  async function saveMentorProfile() {
    if (!me) return;
    setProfileMsg(null);
    setSavingProfile(true);

    try {
      validateMentorProfileOrThrow();
      await persistMentorProfile();
      setProfileMsg("Saved ✅");
    } catch (e: any) {
      setProfileMsg(e?.message || "Profile update failed");
    } finally {
      setSavingProfile(false);
    }
  }

  function onPickFile(f: File | null) {
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  }

  function validateProvinceOrThrow() {
    if (!province) throw new Error("Please select a province.");
  }

  function validateRequiredBikeFieldsOrThrow() {
    const mk = make.trim();
    const md = model.trim();
    const ct = city.trim();
    const yr = year.trim() ? Number(year.trim()) : NaN;
    const cc = engineSize.trim() ? Number(engineSize.trim()) : NaN;

    if (!mk) throw new Error("Please enter your bike make.");
    if (!md) throw new Error("Please enter your bike model.");
    if (!Number.isFinite(yr) || yr < 1950 || yr > new Date().getFullYear() + 1) {
      throw new Error("Please enter a valid bike year.");
    }
    if (!Number.isFinite(cc) || cc <= 0 || cc > 2500) {
      throw new Error("Please enter a valid engine size (cc).");
    }
    if (!ct) throw new Error("Please enter your city.");
  }

  async function ensureBikeRow(): Promise<Bike> {
    if (!me) throw new Error("Not signed in");

    validateProvinceOrThrow();
    validateRequiredBikeFieldsOrThrow();

    if (bike) return bike;

    const insertRes = await sb
      .from("bikes")
      .insert({
        owner_id: me,
        make: make || null,
        model: model || null,
        year: year ? Number(year) : null,
        engine_size: engineSize ? Number(engineSize) : null,
        city: city || null,
        province: province as ProvinceCode,
        is_active: active,
      })
      .select("id, owner_id, make, model, year, engine_size, city, province, is_active")
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
      setProfileMsg(null);

      validateMentorProfileOrThrow();
      await persistMentorProfile();

      validateProvinceOrThrow();
      validateRequiredBikeFieldsOrThrow();

      const b = await ensureBikeRow();

      const upd = await sb
        .from("bikes")
        .update({
          make: make || null,
          model: model || null,
          year: year ? Number(year) : null,
          engine_size: engineSize ? Number(engineSize) : null,
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
        .select("id, owner_id, make, model, year, engine_size, city, province, is_active")
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
    fontWeight: 600,
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
        <div style={{ marginTop: 8, color: "#64748b", fontWeight: 450 }}>Please sign in first.</div>
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ margin: 0 }}>Edit bike</h1>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 450 }}>
            Province is required. You can list anywhere in Canada — booking opens province-by-province.
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
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fff1f2",
          }}
        >
          <div style={{ fontWeight: 450, color: "#b00020" }}>Error</div>
          <div style={{ marginTop: 6, color: "#7f1d1d", fontWeight: 450 }}>{err}</div>
        </div>
      )}

      <div style={card}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 16 }}>Mentor profile</div>
          <div style={{ color: "#64748b", fontWeight: 650, fontSize: 13 }}>
            Shown to test-takers
          </div>
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 800, color: "#0f172a" }}>
            Why we ask this
          </summary>
          <div style={{ marginTop: 8, color: "#64748b", fontWeight: 650 }}>
            Borrowers already have their road test booked. This profile helps them quickly decide
            whether your bike is realistically a fit for their date, area, and timing without sharing
            private information.
          </div>
        </details>

        <div
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              First name <span style={{ color: "#b00020" }}>*</span>
            </div>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="e.g., Rahim"
              style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }}
            />
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Years riding <span style={{ color: "#b00020" }}>*</span>
            </div>
            <input
              value={yearsRiding}
              onChange={(e) => setYearsRiding(e.target.value)}
              inputMode="numeric"
              placeholder="e.g., 8"
              style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }}
            />
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Base city <span style={{ color: "#b00020" }}>*</span>
            </div>
            <select
              value={baseCity}
              onChange={(e) => setBaseCity(e.target.value)}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                background: "white",
              }}
            >
              <option value="">Select your base city…</option>
              {baseCityOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Advance notice preferred <span style={{ color: "#b00020" }}>*</span>
            </div>
            <select
              value={advanceNoticeHours}
              onChange={(e) => setAdvanceNoticeHours(e.target.value)}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                background: "white",
              }}
            >
              {NOTICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Nearby service cities <span style={{ color: "#b00020" }}>*</span>
            </div>

            {!baseCity ? (
              <div style={{ color: "#64748b", fontWeight: 650 }}>
                Choose your base city first.
              </div>
            ) : serviceCityOptions.length === 0 ? (
              <div style={{ color: "#64748b", fontWeight: 650 }}>
                No nearby service cities configured for that base city yet.
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {serviceCityOptions.map((opt) => {
                    const checked = serviceCities.some((x) => x.toLowerCase() === opt.toLowerCase());
                    return (
                      <label
                        key={opt}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          fontWeight: 750,
                          color: "#0f172a",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setServiceCities((prev) => {
                              const next = on ? [...prev, opt] : prev.filter((x) => x !== opt);
                              return withoutBaseCity(next, baseCity);
                            });
                          }}
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
                <div style={{ marginTop: 8, color: "#64748b", fontWeight: 650, fontSize: 13 }}>
                  Only nearby communities tied to your base city are shown here.
                </div>
              </>
            )}
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Large-city travel areas <span style={{ color: "#b00020" }}>*</span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {QUADRANTS.map((q) => {
                const checked = travelQuadrants.includes(q);
                return (
                  <label
                    key={q}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontWeight: 850,
                      color: "#0f172a",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setTravelQuadrants((prev) => {
                          const set = new Set(prev);
                          if (on) set.add(q);
                          else set.delete(q);
                          return Array.from(set);
                        });
                      }}
                    />
                    {q}
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 8, color: "#64748b", fontWeight: 650, fontSize: 13 }}>
              Keep this for Calgary/Edmonton inner-city comfort zones.
            </div>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Generally available <span style={{ color: "#b00020" }}>*</span>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 750 }}>
                <input
                  type="checkbox"
                  checked={availableWeekdays}
                  onChange={(e) => setAvailableWeekdays(e.target.checked)}
                />
                Weekdays
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 750 }}>
                <input
                  type="checkbox"
                  checked={availableWeekends}
                  onChange={(e) => setAvailableWeekends(e.target.checked)}
                />
                Weekends
              </label>
            </div>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              Time of day you’re usually open to <span style={{ color: "#b00020" }}>*</span>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 750 }}>
                <input
                  type="checkbox"
                  checked={availableMorning}
                  onChange={(e) => setAvailableMorning(e.target.checked)}
                />
                Mornings
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 750 }}>
                <input
                  type="checkbox"
                  checked={availableAfternoon}
                  onChange={(e) => setAvailableAfternoon(e.target.checked)}
                />
                Afternoons
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 750 }}>
                <input
                  type="checkbox"
                  checked={availableEvening}
                  onChange={(e) => setAvailableEvening(e.target.checked)}
                />
                Evenings
              </label>
            </div>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Availability notes</div>
            <textarea
              value={availabilityNotes}
              onChange={(e) => setAvailabilityNotes(e.target.value)}
              rows={4}
              placeholder="e.g., Usually easier on weekends. Downtown Calgary is easiest for me. 48h notice is appreciated."
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                resize: "vertical",
              }}
            />
            <div style={{ marginTop: 8, color: "#64748b", fontWeight: 650, fontSize: 13 }}>
              Keep it practical. This is meant to help the borrower decide quickly.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={saveMentorProfile}
            disabled={savingProfile}
            style={{
              padding: "10px 14px",
              borderRadius: 14,
              border: "1px solid #0f172a",
              fontWeight: 900,
              cursor: savingProfile ? "not-allowed" : "pointer",
              background: "#0f172a",
              color: "white",
            }}
          >
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
          {profileMsg ? (
            <div
              style={{
                fontWeight: 850,
                color: profileMsg.includes("✅") ? "#166534" : "#b00020",
              }}
            >
              {profileMsg}
            </div>
          ) : null}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontWeight: 850, fontSize: 16 }}>
          {bike ? `${bike.year || ""} ${bike.make || ""} ${bike.model || ""}`.trim() || "Your bike" : "Your bike"}
        </div>
        <div style={{ marginTop: 6, color: "#64748b", fontWeight: 450 }}>
          This is what borrowers see.
        </div>

        {loading ? (
          <div style={{ marginTop: 12, color: "#64748b", fontWeight: 450 }}>Loading…</div>
        ) : (
          <>
            <div
              style={{
                marginTop: 14,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 450, marginBottom: 6 }}>
                  Make <span style={{ color: "#b00020" }}>*</span>
                </div>
                <input
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }}
                />
              </div>

              <div>
                <div style={{ fontWeight: 450, marginBottom: 6 }}>
                  Model <span style={{ color: "#b00020" }}>*</span>
                </div>
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }}
                />
              </div>

              <div>
                <div style={{ fontWeight: 450, marginBottom: 6 }}>
                  Year <span style={{ color: "#b00020" }}>*</span>
                </div>
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  inputMode="numeric"
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }}
                />
              </div>

              <div>
                <div style={{ fontWeight: 450, marginBottom: 6 }}>
                  Engine size (cc) <span style={{ color: "#b00020" }}>*</span>
                </div>
                <input
                  value={engineSize}
                  onChange={(e) => setEngineSize(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g., 125"
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }}
                />
              </div>

              <div>
                <div style={{ fontWeight: 450, marginBottom: 6 }}>
                  City <span style={{ color: "#b00020" }}>*</span>
                </div>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid #e2e8f0" }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={{ fontWeight: 450, marginBottom: 6 }}>
                  Province <span style={{ color: "#b00020" }}>*</span>
                </div>
                <select
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e2e8f0",
                    background: "white",
                    fontWeight: 450,
                  }}
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

                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: "pointer", color: "#64748b", fontWeight: 650, fontSize: 13 }}>
                    How province availability works
                  </summary>
                  <div style={{ marginTop: 8, color: "#64748b", fontWeight: 450, fontSize: 13 }}>
                    You can list in any province. If it’s marked “coming soon”, borrowers can see your listing but can’t book until launch.
                  </div>
                </details>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                id="active"
              />
              <label htmlFor="active" style={{ fontWeight: 450 }}>
                Active listing (show in Browse)
              </label>
            </div>

            <hr style={{ marginTop: 14, border: "none", borderTop: "1px solid #e2e8f0" }} />

            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 850 }}>Cover photo</div>
              <div style={{ marginTop: 6, color: "#64748b", fontWeight: 450 }}>
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
                  <img
                    src={previewUrl}
                    alt="Preview"
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                ) : bike && cover ? (
                  <img
                    src={cover}
                    alt="Cover"
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      color: "#64748b",
                      fontWeight: 450,
                    }}
                  >
                    No photo yet
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10 }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                />
              </div>

              {uploading && (
                <div style={{ marginTop: 8, color: "#64748b", fontWeight: 450 }}>
                  Uploading photo…
                </div>
              )}
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