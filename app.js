/* =========================
   CONFIG (PASTE YOURS)
========================= */
const SUPABASE_URL = "https://eyrmotpdjzougbjwtpyr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_wblf71wpsw1y_RsnzSv38w_NzpD7kxQ";
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
  const d = new Date(yyyy, mm-1, dd, 12,0,0);
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

/* Auth UI */
const authLoggedOut = document.getElementById("authLoggedOut");
const authLoggedIn = document.getElementById("authLoggedIn");
const emailInput = document.getElementById("emailInput");
const passInput = document.getElementById("passInput");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const logoutBtn = document.getElementById("logoutBtn");
const switchBtn = document.getElementById("switchBtn");
const userPill = document.getElementById("userPill");
const codePill = document.getElementById("codePill");

/* Join/Create UI */
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
function makeCode(len=6){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
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
    const base = parseDDMMYYYY(it.taken_at) || (it.created_at ? new Date(it.created_at) : null);
    if (from && base && base < from) return false;
    if (toEnd && base && base > toEnd) return false;
    return true;
  });
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
  // Create signed URLs for grid thumbnails
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

  // refresh signed URL for safety (in case expired)
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

  // delete from storage
  const { error: delErr } = await supa.storage.from(BUCKET).remove([currentView.storage_path]);
  if (delErr) {
    console.error(delErr);
    alert("Could not delete file from storage.");
    return;
  }

  // delete row
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
        // reload (simple + reliable)
        await loadItems();
      }
    )
    .subscribe();
}

/* =========================
   Gallery: create / join
========================= */
async function setGallery(codeRaw){
  const code = (codeRaw || "").trim().toUpperCase();
  if (!code) return;

  // load gallery
  const { data: g, error: gErr } = await supa.from("galleries").select("*").eq("code", code).maybeSingle();
  if (gErr) { console.error(gErr); alert("Gallery error."); return; }
  if (!g) { joinStatus.textContent = "Code not found."; return; }

  // join (add uid if missing)
  const uid = session.user.id;
  const members = Array.isArray(g.members) ? g.members : [];
  if (!members.includes(uid)) {
    const { error: uErr } = await supa
      .from("galleries")
      .update({ members: [...members, uid], updated_at: new Date().toISOString() })
      .eq("code", code);
    if (uErr) { console.error(uErr); alert("Could not join gallery."); return; }
  }

  currentCode = code;
  localStorage.setItem(`gallery_code_${uid}`, code);

  codePill.textContent = `Code: ${code}`;
  joinCard.style.display = "none";
  openAdd.disabled = false;

  await loadItems();
  startRealtime();
}

createGalleryBtn.addEventListener("click", async () => {
  if (!session) { alert("Please log in first."); return; }

  // create unique code
  let code = makeCode(6);
  for (let i=0;i<8;i++){
    const { data } = await supa.from("galleries").select("code").eq("code", code).maybeSingle();
    if (!data) break;
    code = makeCode(6);
  }

  const uid = session.user.id;
  const { error } = await supa.from("galleries").insert({
    code,
    created_by: uid,
    members: [uid],
  });

  if (error) {
    console.error(error);
    alert("Could not create gallery.");
    return;
  }

  joinStatus.textContent = `Created! Your code is: ${code}`;
  await setGallery(code);
});

joinGalleryBtn.addEventListener("click", async () => {
  if (!session) { alert("Please log in first."); return; }
  await setGallery(joinCodeInput.value);
});

switchBtn.addEventListener("click", () => {
  if (!session) return;
  currentCode = null;
  stopRealtime();
  allItems = [];
  render();

  codePill.textContent = "Code: —";
  joinCard.style.display = "";
  openAdd.disabled = true;
  joinStatus.textContent = "Enter a code to join, or create a new gallery.";
});

/* =========================
   Add item (upload)
========================= */
openAdd.addEventListener("click", () => {
  if (!session || !currentCode) { alert("Log in and join a gallery first."); return; }
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

  // signed url for initial insert + UI (not permanent)
  const url = await signedUrlFor(storagePath);

  const { error: insErr } = await supa.from("items").insert({
    code: currentCode,
    type,
    mime: f.type,
    filename: f.name,
    taken_at: takenStr || null,
    location_text: (locationText.value || "").trim() || null,
    note: (note.value || "").trim() || null,
    storage_path: storagePath,
    public_url: url || "", // kept as field; not truly public (bucket is private)
    created_by: uid,
  });

  if (insErr) {
    console.error(insErr);
    alert("Could not save metadata.");
    // optional rollback
    await supa.storage.from(BUCKET).remove([storagePath]);
    return;
  }

  closeAddDialog();
  // realtime will refresh, but do an instant refresh too:
  await loadItems();
});

/* =========================
   Auth (email/password)
========================= */
async function refreshSessionUI(){
  const { data } = await supa.auth.getSession();
  session = data.session || null;

  if (!session) {
    authLoggedOut.hidden = false;
    authLoggedIn.hidden = true;

    joinCard.style.display = "";
    openAdd.disabled = true;
    userPill.textContent = "—";
    codePill.textContent = "Code: —";

    stopRealtime();
    currentCode = null;
    allItems = [];
    render();
    return;
  }

  authLoggedOut.hidden = true;
  authLoggedIn.hidden = false;

  userPill.textContent = session.user.email || session.user.id;

  // restore last code
  const saved = localStorage.getItem(`gallery_code_${session.user.id}`);
  if (saved) {
    joinStatus.textContent = "Restoring your last gallery...";
    await setGallery(saved);
  } else {
    joinCard.style.display = "";
    openAdd.disabled = true;
    codePill.textContent = "Code: —";
    joinStatus.textContent = "Create a gallery or join with a code.";
  }
}

signupBtn.addEventListener("click", async () => {
  const email = (emailInput.value || "").trim();
  const pass = (passInput.value || "").trim();
  if (!email || !pass) { alert("Email + password required."); return; }

  const { error } = await supa.auth.signUp({ email, password: pass });
  if (error) { alert(error.message); return; }

  alert("Signed up! Now log in.");
});

loginBtn.addEventListener("click", async () => {
  const email = (emailInput.value || "").trim();
  const pass = (passInput.value || "").trim();
  if (!email || !pass) { alert("Email + password required."); return; }

  const { error } = await supa.auth.signInWithPassword({ email, password: pass });
  if (error) { alert(error.message); return; }

  await refreshSessionUI();
});

logoutBtn.addEventListener("click", async () => {
  await supa.auth.signOut();
  await refreshSessionUI();
});

// listen for auth changes
supa.auth.onAuthStateChange(async () => {
  await refreshSessionUI();
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

    const activeDialog = dpActiveInput?.closest("dialog");
    if (activeDialog && activeDialog.contains(e.target)) return;

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

  const hostDialog = input.closest("dialog");
  if (hostDialog) hostDialog.appendChild(dpEl);
  else document.body.appendChild(dpEl);

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
  const firstDow = (first.getDay() + 6) % 7;
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
  joinStatus.textContent = "Log in, then create or join a gallery.";
  await refreshSessionUI();
  render();
})();
