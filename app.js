/* =========================
   CONFIG (YOURS)
========================= */
const SUPABASE_URL = "https://eyrmotpdjzougbjwtpyr.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5cm1vdHBkanpvdWdiand0cHlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODEzODAsImV4cCI6MjA4NjI1NzM4MH0.4E_1J2qnG1hLarenspd3CSg8DUQitUWcywoy3sb105k";
const supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BUCKET = "media";
const SIGNED_URL_SECONDS = 60 * 60; // 1 hour

/* =========================
   Date Helpers (DD/MM/YYYY)
========================= */
function pad2(n){ return String(n).padStart(2,"0"); }
function formatDDMMYYYY(d){ return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`; }
function parseDDMMYYYY(s){
  if(!s) return null;
  const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return null;
  const dd=+m[1], mm=+m[2], yyyy=+m[3];
  if(mm<1||mm>12||dd<1||dd>31) return null;
  const d = new Date(yyyy, mm-1, dd, 12,0,0); // noon avoids day shift
  if(d.getFullYear()!==yyyy||d.getMonth()!==(mm-1)||d.getDate()!==dd) return null;
  return d;
}
function formatWhen(value){
  if(!value) return "—";
  const d = parseDDMMYYYY(value) || new Date(value);
  if(Number.isNaN(d.getTime())) return "—";
  return formatDDMMYYYY(d);
}

/* =========================
   UI Elements
========================= */
const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");

const addDialog = document.getElementById("addDialog");
const openAdd = document.getElementById("openAdd");
const closeAdd = document.getElementById("closeAdd");
const cancelAdd = document.getElementById("cancelAdd");
const addForm = document.getElementById("addForm");
const fileInput = document.getElementById("fileInput");
const takenAt = document.getElementById("takenAt");
const locationText = document.getElementById("locationText");
const note = document.getElementById("note");

const viewDialog = document.getElementById("viewDialog");
const closeView = document.getElementById("closeView");
const viewer = document.getElementById("viewer");
const metaWhen = document.getElementById("metaWhen");
const metaWhere = document.getElementById("metaWhere");
const metaNote = document.getElementById("metaNote");
const deleteBtn = document.getElementById("deleteBtn");
const downloadLink = document.getElementById("downloadLink");

const searchInput = document.getElementById("searchInput");
const typeFilter = document.getElementById("typeFilter");
const fromDate = document.getElementById("fromDate");
const toDate = document.getElementById("toDate");
const clearFilters = document.getElementById("clearFilters");

const exportBtn = document.getElementById("exportBtn");
const importInput = document.getElementById("importInput");

const userPill = document.getElementById("userPill");
const codePill = document.getElementById("codePill");
const switchBtn = document.getElementById("switchBtn");

const joinCard = document.getElementById("joinCard");
const createGalleryBtn = document.getElementById("createGalleryBtn");
const joinCodeInput = document.getElementById("joinCodeInput");
const joinGalleryBtn = document.getElementById("joinGalleryBtn");
const joinStatus = document.getElementById("joinStatus");

/* =========================
   State
========================= */
let session = null;
let currentCode = null;
let allItems = [];
let currentView = null;
let realtimeChannel = null;

/* =========================
   Helpers
========================= */
function makeCode(len=10){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
  let out="";
  for(let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}

function setTypeFilter(value) {
  typeFilter.dataset.value = value;
  const label = typeFilter.querySelector(".dd-label");
  const items = Array.from(typeFilter.querySelectorAll(".dd-item"));
  const selected = items.find(i => i.dataset.value === value) || items[0];
  if (label && selected) label.textContent = selected.textContent;
  items.forEach(it => it.setAttribute("aria-selected", it.dataset.value === value ? "true" : "false"));
  render();
}

(function initTypeDropdown(){
  const dd = typeFilter;
  const btn = dd.querySelector(".dd-btn");
  const menu = dd.querySelector(".dd-menu");
  const items = Array.from(dd.querySelectorAll(".dd-item"));

  function open(){ dd.classList.add("open"); btn.setAttribute("aria-expanded","true"); menu.focus(); }
  function close(){ dd.classList.remove("open"); btn.setAttribute("aria-expanded","false"); }

  btn.addEventListener("click", ()=> dd.classList.contains("open") ? close() : open());
  items.forEach(it => it.addEventListener("click", ()=>{ setTypeFilter(it.dataset.value); close(); }));
  document.addEventListener("mousedown",(e)=>{ if(!dd.contains(e.target)) close(); });

  setTypeFilter(dd.dataset.value || "all");
})();

function applyFilters(items){
  const q = (searchInput.value || "").trim().toLowerCase();
  const t = typeFilter.dataset.value || "all";

  const from = parseDDMMYYYY(fromDate.value);
  const to = parseDDMMYYYY(toDate.value);
  const toEnd = to ? new Date(to.getTime() + 24*60*60*1000 - 1) : null;

  return items.filter(it => {
    if (t !== "all" && it.type !== t) return false;
    if (q) {
      const hay = `${it.location_text||""} ${it.note||""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    const base = parseDDMMYYYY(it.taken_at) || new Date(it.created_at || 0);
    if (from && base < from) return false;
    if (toEnd && base > toEnd) return false;
    return true;
  });
}

/* =========================
   Auth (anonymous)
========================= */
async function ensureAnonSession(){
  const { data } = await supa.auth.getSession();
  session = data.session || null;

  if (!session) {
    const { data: s, error } = await supa.auth.signInAnonymously();
    if (error) {
      console.error(error);
      alert("Anonymous sign-in failed. Enable Auth → Providers → Anonymous in Supabase.");
      return false;
    }
    session = s.session;
  }

  userPill.textContent = `Guest: ${session.user.id.slice(0,8)}`;
  return true;
}

/* =========================
   Storage: signed URL
========================= */
async function signedUrlFor(path){
  if (!path) return null;
  const { data, error } = await supa.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) {
    console.error("Signed URL error:", error);
    return null;
  }
  return data.signedUrl;
}

async function hydrateSignedUrls(rows){
  const out = [];
  for (const r of rows) {
    const url = await signedUrlFor(r.storage_path);
    out.push({ ...r, _signedUrl: url });
  }
  return out;
}

/* =========================
   Rendering
========================= */
function render(){
  const items = applyFilters(allItems).sort((a,b)=>{
    const da = parseDDMMYYYY(a.taken_at) || new Date(a.created_at || 0);
    const db = parseDDMMYYYY(b.taken_at) || new Date(b.created_at || 0);
    return db - da;
  });

  grid.innerHTML = "";
  emptyState.hidden = items.length !== 0;

  for (const it of items) {
    const tile = document.createElement("article");
    tile.className = "tile";
    tile.tabIndex = 0;

    const thumb = document.createElement("div");
    thumb.className = "thumb";

    const src = it._signedUrl || "";
    if (it.type === "image") {
      const img = document.createElement("img");
      img.src = src;
      img.alt = it.note ? `Photo: ${it.note}` : "Photo";
      thumb.appendChild(img);
    } else {
      const v = document.createElement("video");
      v.src = src;
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      thumb.appendChild(v);

      const play = document.createElement("div");
      play.style.position = "absolute";
      play.style.padding = "8px 10px";
      play.style.borderRadius = "999px";
      play.style.border = "1px solid rgba(255,255,255,.18)";
      play.style.background = "rgba(0,0,0,.35)";
      play.textContent = "▶";
      thumb.style.position = "relative";
      thumb.appendChild(play);
    }

    const body = document.createElement("div");
    body.className = "tileBody";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = `${it.type === "image" ? "🖼️ Photo" : "🎬 Video"} • ${formatWhen(it.taken_at || it.created_at)}`;

    const meta = document.createElement("div");
    meta.className = "metaLine";
    meta.textContent = it.location_text || it.note || "No description";

    body.appendChild(badge);
    body.appendChild(meta);

    tile.appendChild(thumb);
    tile.appendChild(body);

    const open = () => openViewer(it);
    tile.addEventListener("click", open);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });

    grid.appendChild(tile);
  }
}

/* =========================
   Viewer
========================= */
async function openViewer(it){
  currentView = it;

  const fresh = await signedUrlFor(it.storage_path);
  const url = fresh || it._signedUrl;

  viewer.innerHTML = "";
  if (it.type === "image") {
    const img = document.createElement("img");
    img.src = url || "";
    viewer.appendChild(img);
    downloadLink.textContent = "Download photo";
  } else {
    const v = document.createElement("video");
    v.src = url || "";
    v.controls = true;
    v.playsInline = true;
    viewer.appendChild(v);
    downloadLink.textContent = "Download video";
  }

  metaWhen.textContent = formatWhen(it.taken_at || it.created_at);
  metaWhere.textContent = it.location_text || "—";
  metaNote.textContent = it.note || "—";

  downloadLink.href = url || "";
  downloadLink.download = it.filename || (it.type === "image" ? "image" : "video");

  viewDialog.showModal();
}

closeView.addEventListener("click", () => viewDialog.close());

deleteBtn.addEventListener("click", async () => {
  if (!session || !currentCode || !currentView) return;

  const ok = confirm("Delete this item?");
  if (!ok) return;

  const { error: delErr } = await supa.storage.from(BUCKET).remove([currentView.storage_path]);
  if (delErr) {
    console.error(delErr);
    alert("Could not delete file from storage.");
    return;
  }

  const { error: rowErr } = await supa.from("items").delete().eq("id", currentView.id);
  if (rowErr) {
    console.error(rowErr);
    alert("Could not delete database record.");
    return;
  }

  viewDialog.close();
  currentView = null;
});

/* =========================
   DB: load + realtime
========================= */
async function loadItems(){
  if (!currentCode) return;

  const { data, error } = await supa
    .from("items")
    .select("*")
    .eq("code", currentCode);

  if (error) {
    console.error(error);
    alert("Could not load items.");
    return;
  }

  allItems = await hydrateSignedUrls(data || []);
  render();
}

function stopRealtime(){
  if (realtimeChannel) {
    supa.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

function startRealtime(){
  stopRealtime();
  if (!currentCode) return;

  realtimeChannel = supa
    .channel(`items:${currentCode}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "items", filter: `code=eq.${currentCode}` },
      async () => {
        await loadItems();
      }
    )
    .subscribe();
}

/* =========================
   Gallery: create / join (CODE ONLY via RPC)
========================= */
async function setGallery(codeRaw){
  const code = (codeRaw || "").trim().toUpperCase();
  if (!code) return;

  const { data, error } = await supa.rpc("join_gallery_code_only", { p_code: code });
  if (error) {
    console.error(error);
    joinStatus.textContent = "Join failed (RPC error).";
    return;
  }
  if (!data) {
    joinStatus.textContent = "Code not found.";
    return;
  }

  currentCode = code;
  localStorage.setItem("gallery_code", code);

  codePill.textContent = `Code: ${code}`;
  joinCard.style.display = "none";
  openAdd.disabled = false;
  exportBtn.disabled = false;
  importInput.disabled = false;

  await loadItems();
  startRealtime();
}

createGalleryBtn.addEventListener("click", async () => {
  if (!session) return;

  let code = makeCode(10);
  for (let i=0;i<12;i++){
    const { data, error } = await supa.rpc("create_gallery_code_only", { p_code: code });
    if (error) {
      console.error(error);
      alert("Could not create gallery (RPC error).");
      return;
    }
    if (data === true) break; // created
    code = makeCode(10); // try again
  }

  joinStatus.textContent = `Created! Your code is: ${code}`;
  await setGallery(code);
});

joinGalleryBtn.addEventListener("click", async () => {
  if (!session) return;
  await setGallery(joinCodeInput.value);
});

switchBtn.addEventListener("click", () => {
  currentCode = null;
  stopRealtime();
  allItems = [];
  render();

  codePill.textContent = "Code: —";
  joinCard.style.display = "";
  openAdd.disabled = true;
  exportBtn.disabled = true;
  importInput.disabled = true;
  joinStatus.textContent = "Enter a code to join, or create a new gallery.";
});

/* =========================
   Add item (upload)
========================= */
openAdd.addEventListener("click", () => {
  if (!session || !currentCode) { alert("Join a gallery first."); return; }
  addDialog.showModal();
});

function closeAddDialog(){
  addDialog.close();
  addForm.reset();
}
closeAdd.addEventListener("click", closeAddDialog);
cancelAdd.addEventListener("click", closeAddDialog);

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!session || !currentCode) return;

  const f = fileInput.files?.[0];
  if (!f) return;

  const takenStr = (takenAt.value || "").trim();
  if (takenStr && !parseDDMMYYYY(takenStr)) {
    alert("Please enter a valid date in DD/MM/YYYY.");
    return;
  }

  const type = f.type.startsWith("video/") ? "video" : "image";
  const uid = session.user.id;

  const safeName = f.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${currentCode}/${uid}/${Date.now()}_${safeName}`;

  const { error: upErr } = await supa.storage.from(BUCKET).upload(storagePath, f, {
    upsert: false,
    contentType: f.type,
  });
  if (upErr) {
    console.error(upErr);
    alert("Upload failed.");
    return;
  }

  const { error: insErr } = await supa.from("items").insert({
    code: currentCode,
    type,
    mime: f.type,
    filename: f.name,
    taken_at: takenStr || null,
    location_text: (locationText.value || "").trim() || null,
    note: (note.value || "").trim() || null,
    storage_path: storagePath,
    public_url: null,
    created_by: uid,
  });

  if (insErr) {
    console.error(insErr);
    alert("Could not save metadata.");
    await supa.storage.from(BUCKET).remove([storagePath]);
    return;
  }

  closeAddDialog();
  await loadItems();
});

/* =========================
   Export / Import (JSON) – optional
========================= */
exportBtn.addEventListener("click", async () => {
  if (!currentCode) return;

  const { data, error } = await supa.from("items").select("*").eq("code", currentCode);
  if (error) { console.error(error); alert("Export failed."); return; }

  const json = JSON.stringify({ version: 1, code: currentCode, exportedAt: new Date().toISOString(), items: data || [] }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `gallery-${currentCode}-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

importInput.addEventListener("change", async () => {
  // NOTE: this imports metadata only (not files). Keeping it simple.
  importInput.value = "";
  alert("Import is disabled for now (metadata-only). If you want full import including files, tell me.");
});

/* =========================
   Filters
========================= */
[searchInput, fromDate, toDate].forEach(el => el.addEventListener("input", render));
clearFilters.addEventListener("click", () => {
  searchInput.value = "";
  fromDate.value = "";
  toDate.value = "";
  setTypeFilter("all");
});

/* =========================
   Custom Date Picker (dialog-safe)
========================= */
const MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW_EN = ["Mo","Tu","We","Th","Fr","Sa","Su"];

let dpEl = null;
let dpActiveInput = null;
let dpMonth = null;

function ensureDatepicker() {
  if (dpEl) return dpEl;

  dpEl = document.createElement("div");
  dpEl.className = "datepicker";
  dpEl.style.display = "none";
  dpEl.innerHTML = `
    <div class="dp-head">
      <div class="dp-title" id="dpTitle"></div>
      <div class="dp-nav">
        <button type="button" class="dp-btn" id="dpPrev" aria-label="Previous month">‹</button>
        <button type="button" class="dp-btn" id="dpNext" aria-label="Next month">›</button>
      </div>
    </div>
    <div class="dp-grid" id="dpGrid"></div>
    <div class="dp-foot">
      <button type="button" class="dp-link" id="dpClear">Clear</button>
      <button type="button" class="dp-link" id="dpToday">Today</button>
    </div>
  `;
  document.body.appendChild(dpEl);

  dpEl.querySelector("#dpPrev").addEventListener("click", () => shiftMonth(-1));
  dpEl.querySelector("#dpNext").addEventListener("click", () => shiftMonth(+1));

  dpEl.querySelector("#dpClear").addEventListener("click", () => {
    if (!dpActiveInput) return;
    dpActiveInput.value = "";
    closeDatepicker();
    render();
  });

  dpEl.querySelector("#dpToday").addEventListener("click", () => {
    if (!dpActiveInput) return;
    dpActiveInput.value = formatDDMMYYYY(new Date());
    closeDatepicker();
    render();
  });

  document.addEventListener("mousedown", (e) => {
    if (!dpEl || dpEl.style.display === "none") return;
    if (dpEl.contains(e.target)) return;
    if (dpActiveInput && (e.target === dpActiveInput || dpActiveInput.contains(e.target))) return;
    closeDatepicker();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDatepicker();
  });

  window.addEventListener("resize", () => {
    if (dpEl && dpEl.style.display !== "none" && dpActiveInput) positionDatepicker(dpActiveInput);
  });
  window.addEventListener("scroll", () => {
    if (dpEl && dpEl.style.display !== "none" && dpActiveInput) positionDatepicker(dpActiveInput);
  }, true);

  return dpEl;
}

function openDatepickerForInput(input) {
  ensureDatepicker();
  dpActiveInput = input;

  const parsed = parseDDMMYYYY(input.value);
  const base = parsed || new Date();
  dpMonth = new Date(base.getFullYear(), base.getMonth(), 1, 12, 0, 0);

  positionDatepicker(input);
  renderDatepicker();
  dpEl.style.display = "block";
}

function closeDatepicker() {
  if (!dpEl) return;
  dpEl.style.display = "none";
  dpActiveInput = null;
}

function positionDatepicker(input) {
  const r = input.getBoundingClientRect();
  let top = r.bottom + 8;
  let left = r.left;

  if (top + dpEl.offsetHeight > window.innerHeight - 10) {
    top = Math.max(10, r.top - dpEl.offsetHeight - 8);
  }
  const maxLeft = window.innerWidth - dpEl.offsetWidth - 10;
  if (left > maxLeft) left = Math.max(10, maxLeft);

  dpEl.style.top = `${top}px`;
  dpEl.style.left = `${left}px`;
}

function shiftMonth(delta) {
  if (!dpMonth) return;
  dpMonth = new Date(dpMonth.getFullYear(), dpMonth.getMonth() + delta, 1, 12, 0, 0);
  renderDatepicker();
}

function sameDay(a, b) {
  return a && b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function renderDatepicker() {
  const title = dpEl.querySelector("#dpTitle");
  const grid = dpEl.querySelector("#dpGrid");
  grid.innerHTML = "";

  const year = dpMonth.getFullYear();
  const month = dpMonth.getMonth();
  title.textContent = `${MONTHS_EN[month]} ${year}`;

  for (const d of DOW_EN) {
    const el = document.createElement("div");
    el.className = "dp-dow";
    el.textContent = d;
    grid.appendChild(el);
  }

  const first = new Date(year, month, 1, 12, 0, 0);
  const firstDow = (first.getDay() + 6) % 7; // monday start
  const start = new Date(year, month, 1 - firstDow, 12, 0, 0);

  const selected = dpActiveInput ? parseDDMMYYYY(dpActiveInput.value) : null;

  for (let i = 0; i < 42; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12, 0, 0);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dp-day";
    btn.textContent = String(day.getDate());

    if (day.getMonth() !== month) btn.classList.add("muted");
    if (sameDay(day, selected)) btn.classList.add("selected");

    btn.addEventListener("click", () => {
      if (!dpActiveInput) return;
      dpActiveInput.value = formatDDMMYYYY(day);
      closeDatepicker();
      render();
    });

    grid.appendChild(btn);
  }
}

function bindDatepicker(input) {
  input.addEventListener("focus", () => openDatepickerForInput(input));
  input.addEventListener("click", () => openDatepickerForInput(input));

  input.addEventListener("input", () => {
    const raw = input.value.replace(/[^\d]/g, "").slice(0, 8);
    let out = raw;
    if (raw.length >= 3) out = `${raw.slice(0,2)}/${raw.slice(2)}`;
    if (raw.length >= 5) out = `${raw.slice(0,2)}/${raw.slice(2,4)}/${raw.slice(4)}`;
    input.value = out;
  });

  input.addEventListener("blur", () => {
    const active = document.activeElement;
    if (dpEl && dpEl.contains(active)) return;
    if (!input.value) return;
    if (!parseDDMMYYYY(input.value)) {
      input.value = "";
      render();
    }
  });
}
document.querySelectorAll(".date-input").forEach(bindDatepicker);

/* =========================
   Init
========================= */
(async function init(){
  openAdd.disabled = true;
  exportBtn.disabled = true;
  importInput.disabled = true;

  joinStatus.textContent = "Connecting…";

  const ok = await ensureAnonSession();
  if (!ok) return;

  joinStatus.textContent = "Enter a code to join, or create a new gallery.";

  const saved = localStorage.getItem("gallery_code");
  if (saved) {
    joinStatus.textContent = "Restoring your last gallery…";
    await setGallery(saved);
  } else {
    joinCard.style.display = "";
    codePill.textContent = "Code: —";
  }

  render();
})();
