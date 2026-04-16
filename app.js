// ====== STATE ======
const state = {
  files: [],
  exams: [{ id: 1, subject: "", date: "", type: "scritto", level: "da zero" }],
  prefs: {
    startDate: new Date().toISOString().split("T")[0],
    hours: 4,
    days: 6,
    rest: "domenica",
    context: "università",
    stress: "normale",
    notes: ""
  },
  currentStep: 1,
  plan: null
};

// ====== UTILS ======
function escapeHTML(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHTML(s); }

// ====== VIEW SWITCH ======
function showApp() {
  document.getElementById("landing").classList.remove("active");
  document.getElementById("app").classList.add("active");
  window.scrollTo(0, 0);
  renderExams();
  initPrefs();
  updateStepBar();
}
function showLanding() {
  document.getElementById("app").classList.remove("active");
  document.getElementById("landing").classList.add("active");
  window.scrollTo(0, 0);
}

// ====== STEP NAV ======
function goToStep(n) {
  state.currentStep = n;
  document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("step-" + n).classList.add("active");
  updateStepBar();
  window.scrollTo(0, 0);
}

function updateStepBar() {
  document.querySelectorAll(".step").forEach(el => {
    const num = parseInt(el.dataset.step);
    el.classList.remove("active", "done");
    if (num === state.currentStep) el.classList.add("active");
    else if (num < state.currentStep) el.classList.add("done");
  });
}

// ====== FILE UPLOAD ======
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function handleFiles(fileList) {
  const arr = Array.from(fileList);
  for (const file of arr) {
    if (file.size > 15 * 1024 * 1024) {
      alert('Il file "' + file.name + '" è troppo grande (max 15MB).');
      continue;
    }
    try {
      const base64 = await fileToBase64(file);
      state.files.push({
        id: Math.random().toString(36).slice(2),
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        base64: base64.split(",")[1]
      });
    } catch (err) {
      console.error("Errore caricamento file:", err);
    }
  }
  renderFiles();
}

function renderFiles() {
  const list = document.getElementById("file-list");
  const hint = document.getElementById("files-hint");
  if (!list || !hint) return;
  if (state.files.length === 0) {
    list.innerHTML = "";
    hint.textContent = "Puoi proseguire anche senza allegare file";
    return;
  }
  hint.textContent = state.files.length + " materiali pronti per l'analisi";
  list.innerHTML = state.files.map(f =>
    '<div class="file-item">' +
      '<div class="file-item-info">' +
        '<span class="file-icon">◆</span>' +
        '<span class="file-name">' + escapeHTML(f.name) + '</span>' +
        '<span class="file-name-meta">' + (f.size / 1024).toFixed(0) + ' KB</span>' +
      '</div>' +
      '<button class="file-remove" onclick="removeFile(\'' + f.id + '\')">×</button>' +
    '</div>'
  ).join("");
}

function removeFile(id) {
  state.files = state.files.filter(f => f.id !== id);
  renderFiles();
}

// ====== EXAMS ======
function renderExams() {
  const list = document.getElementById("exams-list");
  if (!list) return;
  list.innerHTML = state.exams.map((e, idx) => {
    const types = ["scritto","orale","scritto e orale","test a crocette","progetto","intercorso"];
    const levels = ["da zero","qualche lezione seguita","metà programma","quasi finito","solo ripasso"];
    return '<div class="exam-card">' +
      '<div class="exam-head">' +
        '<span class="exam-num">Esame №' + String(idx + 1).padStart(2, "0") + '</span>' +
        (state.exams.length > 1 ? '<button class="exam-remove" onclick="removeExam(' + e.id + ')">×</button>' : '') +
      '</div>' +
      '<div class="exam-grid">' +
        '<div class="exam-field">' +
          '<label>Materia</label>' +
          '<input type="text" value="' + escapeAttr(e.subject) + '" oninput="updateExam(' + e.id + ',\'subject\',this.value)" placeholder="es. Diritto Privato">' +
        '</div>' +
        '<div class="exam-field">' +
          '<label>Data</label>' +
          '<input type="date" value="' + e.date + '" oninput="updateExam(' + e.id + ',\'date\',this.value)">' +
        '</div>' +
        '<div class="exam-field">' +
          '<label>Modalità</label>' +
          '<select onchange="updateExam(' + e.id + ',\'type\',this.value)">' +
            types.map(t => '<option ' + (e.type===t?"selected":"") + '>' + t + '</option>').join("") +
          '</select>' +
        '</div>' +
        '<div class="exam-field">' +
          '<label>Livello di partenza</label>' +
          '<select onchange="updateExam(' + e.id + ',\'level\',this.value)">' +
            levels.map(l => '<option ' + (e.level===l?"selected":"") + '>' + l + '</option>').join("") +
          '</select>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("");
  updateStep2Btn();
}

function addExam() {
  state.exams.push({ id: Date.now(), subject: "", date: "", type: "scritto", level: "da zero" });
  renderExams();
}
function removeExam(id) {
  state.exams = state.exams.filter(e => e.id !== id);
  renderExams();
}
function updateExam(id, field, val) {
  const ex = state.exams.find(e => e.id === id);
  if (ex) { ex[field] = val; updateStep2Btn(); }
}
function updateStep2Btn() {
  const valid = state.exams.some(e => e.subject.trim() && e.date);
  const btn = document.getElementById("btn-to-3");
  if (btn) btn.disabled = !valid;
}

// ====== PREFERENCES ======
function initPrefs() {
  const pref = state.prefs;
  const sd = document.getElementById("pref-startDate");
  const ph = document.getElementById("pref-hours");
  const pd = document.getElementById("pref-days");
  const pr = document.getElementById("pref-rest");
  const pc = document.getElementById("pref-context");
  const ps = document.getElementById("pref-stress");
  const pn = document.getElementById("pref-notes");
  const hl = document.getElementById("hoursLabel");
  const dl = document.getElementById("daysLabel");
  if (sd) sd.value = pref.startDate;
  if (ph) ph.value = pref.hours;
  if (pd) pd.value = pref.days;
  if (pr) pr.value = pref.rest;
  if (pc) pc.value = pref.context;
  if (ps) ps.value = pref.stress;
  if (pn) pn.value = pref.notes;
  if (hl) hl.textContent = pref.hours + "h";
  if (dl) dl.textContent = pref.days;
}

// ====== PLAN GENERATION ======
async function generatePlan() {
  goToStep(4);
  const loadingEl = document.getElementById("loading-state");
  const contentEl = document.getElementById("plan-content");
  if (loadingEl) loadingEl.style.display = "block";
  if (contentEl) contentEl.style.display = "none";

  const stages = [
    "Analisi dei materiali in corso…",
    "Stima del volume di studio…",
    "Applicazione della curva dell'oblio…",
    "Costruzione del calendario…",
    "Rifinitura del piano…"
  ];
  let sIdx = 0;
  const stageEl = document.getElementById("loading-stage");
  const stageInt = setInterval(() => {
    sIdx = (sIdx + 1) % stages.length;
    if (stageEl) stageEl.textContent = stages[sIdx];
  }, 4000);

  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exams: state.exams.filter(e => e.subject && e.date),
        prefs: state.prefs,
        files: state.files.map(f => ({
          name: f.name,
          mimeType: f.mimeType,
          base64: f.base64
        }))
      })
    });

    clearInterval(stageInt);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ("Errore del server (" + res.status + ")"));
    }

    const data = await res.json();
    state.plan = data.plan;
    renderPlan();
    if (loadingEl) loadingEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";

  } catch (err) {
    clearInterval(stageInt);
    if (loadingEl) loadingEl.style.display = "none";
    goToStep(3);
    const errorBox = document.getElementById("error-box");
    if (errorBox) {
      errorBox.style.display = "block";
      errorBox.textContent = "Errore: " + err.message + ". Riprova tra poco.";
    }
  }
}

// ====== RENDER PLAN ======
function renderPlan() {
  const p = state.plan;
  if (!p) return;
  const container = document.getElementById("plan-content");
  if (!container) return;

  let html = '';
  html += '<div class="plan-header">';
  html +=   '<div class="plan-title-group">';
  html +=     '<div class="section-overline">Capitolo IV · Esito</div>';
  html +=     '<h2 class="section-title">Il tuo piano.</h2>';
  html +=     '<p class="plan-summary">' + escapeHTML(p.summary || "") + '</p>';
  html +=   '</div>';
  html +=   '<button class="btn btn-primary" onclick="downloadPlan()">↓ Scarica</button>';
  html += '</div>';

  html += '<section class="plan-section plan-strategy">';
  html +=   '<div class="plan-section-title">Strategia</div>';
  html +=   '<p>' + escapeHTML(p.strategy || "") + '</p>';
  html += '</section>';

  if (p.phases && p.phases.length) {
    html += '<div class="plan-section-title" style="margin-top:2rem; margin-bottom:1rem">Le fasi</div><div class="phases-grid">';
    p.phases.forEach((ph, i) => {
      html += '<div class="phase-card">';
      html +=   '<div class="phase-num">Fase ' + String(i+1).padStart(2,"0") + '</div>';
      html +=   '<div class="phase-name">' + escapeHTML(ph.name || "") + '</div>';
      html +=   '<div class="phase-period">' + escapeHTML(ph.period || "") + '</div>';
      html +=   '<p class="phase-desc">' + escapeHTML(ph.description || "") + '</p>';
      html += '</div>';
    });
    html += '</div>';
  }

  if (p.schedule && p.schedule.length) {
    html += '<div class="plan-section-title" style="margin-top:2rem; margin-bottom:1rem">Calendario</div><div class="schedule-list">';
    p.schedule.forEach(d => {
      const isRest = d.isRest || !d.sessions || d.sessions.length === 0;
      html += '<div class="day-card ' + (isRest ? "rest" : "") + '">';
      html +=   '<div class="day-head">';
      html +=     '<div>';
      html +=       '<span class="day-name">' + escapeHTML(d.dayName || "") + '</span>';
      html +=       '<span class="day-date">' + escapeHTML(d.date || "") + '</span>';
      html +=     '</div>';
      html +=     (isRest ? '<span class="day-rest-badge">Riposo</span>' : '<span class="day-hours">◷ ' + (d.totalHours || 0) + 'h</span>');
      html +=   '</div>';
      if (!isRest && d.sessions) {
        html += '<div class="sessions">';
        d.sessions.forEach(s => {
          html += '<div class="session">';
          html +=   '<div class="session-top">';
          html +=     '<span class="session-subject">' + escapeHTML(s.subject || "") + '</span>';
          html +=     '<span class="session-duration">' + escapeHTML(s.duration || "") + '</span>';
          html +=   '</div>';
          html +=   '<div class="session-topic">' + escapeHTML(s.topic || "") + '</div>';
          html +=   '<div class="session-meta">' + escapeHTML(s.activity || "") + ' · ' + escapeHTML(s.goal || "") + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }

  if (p.tips && p.tips.length) {
    html += '<section class="tips-section">';
    html +=   '<div class="plan-section-title">In chiusura</div>';
    html +=   '<ul class="tips-list">';
    p.tips.forEach(t => {
      html += '<li><span class="tip-marker">◆</span><span>' + escapeHTML(t) + '</span></li>';
    });
    html +=   '</ul>';
    html += '</section>';
  }

  html += '<div class="plan-footer">';
  html +=   '<button class="btn btn-text" onclick="goToStep(3)">← Modifica preferenze</button>';
  html +=   '<button class="btn btn-text" onclick="resetAll()">Nuovo piano</button>';
  html += '</div>';

  container.innerHTML = html;
}

function resetAll() {
  state.files = [];
  state.exams = [{ id: 1, subject: "", date: "", type: "scritto", level: "da zero" }];
  state.prefs = { startDate: new Date().toISOString().split("T")[0], hours: 4, days: 6, rest: "domenica", context: "università", stress: "normale", notes: "" };
  state.plan = null;
  renderFiles();
  renderExams();
  initPrefs();
  goToStep(1);
}

// ====== DOWNLOAD ======
function downloadPlan() {
  const p = state.plan;
  if (!p) return;
  let c = "STUDIUM — PIANO DI STUDIO\n" + "=".repeat(60) + "\n\n";
  c += "RIEPILOGO\n" + (p.summary || "") + "\n\n";
  c += "STRATEGIA\n" + (p.strategy || "") + "\n\n";
  if (p.phases) {
    c += "FASI\n" + "-".repeat(60) + "\n";
    p.phases.forEach((ph, i) => {
      c += (i+1) + ". " + ph.name + " (" + ph.period + ")\n   " + ph.description + "\n\n";
    });
  }
  if (p.schedule) {
    c += "\nCALENDARIO\n" + "=".repeat(60) + "\n";
    p.schedule.forEach(d => {
      const isRest = d.isRest || !d.sessions || !d.sessions.length;
      c += "\n" + d.dayName + " " + d.date + (isRest ? " — RIPOSO" : " (" + d.totalHours + "h)") + "\n";
      if (!isRest && d.sessions) {
        d.sessions.forEach(s => {
          c += "  • " + s.subject + " — " + s.topic + " (" + s.duration + ")\n";
          c += "    " + s.activity + " | " + s.goal + "\n";
        });
      }
    });
  }
  if (p.tips) {
    c += "\n\nCONSIGLI\n" + "=".repeat(60) + "\n";
    p.tips.forEach((t, i) => c += (i+1) + ". " + t + "\n");
  }
  c += "\n\n— Generato da Studium · studium.vercel.app —\n";

  const blob = new Blob([c], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "studium-piano.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ====== ESPONI FUNZIONI GLOBALMENTE (fix compatibilità) ======
window.showApp = showApp;
window.showLanding = showLanding;
window.goToStep = goToStep;
window.addExam = addExam;
window.removeExam = removeExam;
window.updateExam = updateExam;
window.removeFile = removeFile;
window.generatePlan = generatePlan;
window.downloadPlan = downloadPlan;
window.resetAll = resetAll;

// ====== INIT ON DOM READY ======
document.addEventListener("DOMContentLoaded", function() {
  // File upload listeners
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("file-input");
  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", e => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener("change", e => handleFiles(e.target.files));
  }

  // Preferences listeners
  const phInput = document.getElementById("pref-hours");
  if (phInput) phInput.addEventListener("input", e => {
    state.prefs.hours = parseInt(e.target.value);
    const hl = document.getElementById("hoursLabel");
    if (hl) hl.textContent = e.target.value + "h";
  });
  const pdInput = document.getElementById("pref-days");
  if (pdInput) pdInput.addEventListener("input", e => {
    state.prefs.days = parseInt(e.target.value);
    const dl = document.getElementById("daysLabel");
    if (dl) dl.textContent = e.target.value;
  });
  ["startDate","rest","context","stress"].forEach(k => {
    const el = document.getElementById("pref-" + k);
    if (el) el.addEventListener("change", e => { state.prefs[k] = e.target.value; });
  });
  const pnInput = document.getElementById("pref-notes");
  if (pnInput) pnInput.addEventListener("input", e => { state.prefs.notes = e.target.value; });
});
