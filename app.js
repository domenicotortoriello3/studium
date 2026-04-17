// ====== STATE ======
const state = {
  files: [],
  manualTopics: "",
  exams: [{
    id: 1,
    subject: "",
    date: "",
    type: "scritto",
    level: "nessuna preparazione",
    knownTopics: "",
    goal: "voto buono"
  }],
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

// Limiti (Vercel Hobby plan: max 4.5MB per request)
const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_TOTAL_SIZE = 3.5 * 1024 * 1024;
const IMAGE_COMPRESS_THRESHOLD = 800 * 1024;
const IMAGE_MAX_DIMENSION = 1800;
const IMAGE_QUALITY = 0.72;

// ====== UTILS ======
function escapeHTML(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHTML(s); }
function getTotalRawSize() { return state.files.reduce((sum, f) => sum + (f.size || 0), 0); }

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

// ====== TABS ======
function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
}

// ====== IMAGE COMPRESSION ======
function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > IMAGE_MAX_DIMENSION || h > IMAGE_MAX_DIMENSION) {
          if (w > h) { h = Math.round(h * IMAGE_MAX_DIMENSION / w); w = IMAGE_MAX_DIMENSION; }
          else { w = Math.round(w * IMAGE_MAX_DIMENSION / h); h = IMAGE_MAX_DIMENSION; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name.replace(/\.(png|webp)$/i, ".jpg"), { type: "image/jpeg" });
          resolve(compressed.size < file.size ? compressed : file);
        }, "image/jpeg", IMAGE_QUALITY);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
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
  const currentTotal = getTotalRawSize();
  let addedSize = 0;

  for (let file of arr) {
    // Compressione automatica immagini
    if (file.type.startsWith("image/") && file.size > IMAGE_COMPRESS_THRESHOLD) {
      const hint = document.getElementById("files-hint");
      if (hint) hint.textContent = "Compressione immagine in corso…";
      file = await compressImage(file);
    }

    if (file.size > MAX_FILE_SIZE) {
      alert('Il file "' + file.name + '" è troppo grande (' + (file.size/1024/1024).toFixed(1) + 'MB).\n\nMassimo: 3MB per file.\n\nPer PDF: comprimilo su ilovepdf.com.');
      continue;
    }
    if (currentTotal + addedSize + file.size > MAX_TOTAL_SIZE) {
      alert('Hai raggiunto il limite totale (3.5MB).\n\nIl file "' + file.name + '" non è stato aggiunto.');
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
      addedSize += file.size;
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
    hint.textContent = "Puoi caricare file, scrivere argomenti, o entrambi";
    return;
  }
  const totalMB = (getTotalRawSize() / 1024 / 1024).toFixed(2);
  hint.textContent = state.files.length + " file · " + totalMB + "MB / 3.5MB";
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
    const types = [
      {v:"scritto", l:"Scritto"},
      {v:"orale", l:"Orale"},
      {v:"scritto e orale", l:"Scritto e orale"},
      {v:"test a crocette", l:"Test a crocette"},
      {v:"progetto", l:"Progetto"},
      {v:"intercorso", l:"Intercorso / parziale"}
    ];
    const levels = [
      {v:"nessuna preparazione", l:"Nessuna preparazione"},
      {v:"qualche lezione seguita", l:"Qualche lezione seguita"},
      {v:"teoria studiata in parte", l:"Teoria studiata in parte"},
      {v:"teoria quasi completa", l:"Teoria quasi completa"},
      {v:"tutto studiato, solo ripasso", l:"Tutto studiato, solo ripasso"}
    ];
    const goals = [
      {v:"massimo dei voti", l:"Massimo dei voti (30 / 30 e lode)"},
      {v:"voto alto", l:"Voto alto (28-30)"},
      {v:"voto buono", l:"Voto buono (25-27)"},
      {v:"voto sufficiente", l:"Voto sufficiente (22-24)"},
      {v:"solo passare", l:"Solo passare, anche con voto minimo"}
    ];

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
          '<label>Data esame</label>' +
          '<input type="date" value="' + e.date + '" oninput="updateExam(' + e.id + ',\'date\',this.value)">' +
        '</div>' +
        '<div class="exam-field">' +
          '<label>Modalità</label>' +
          '<select onchange="updateExam(' + e.id + ',\'type\',this.value)">' +
            types.map(t => '<option value="' + t.v + '" ' + (e.type===t.v?"selected":"") + '>' + t.l + '</option>').join("") +
          '</select>' +
        '</div>' +
        '<div class="exam-field">' +
          '<label>Obiettivo di voto</label>' +
          '<select onchange="updateExam(' + e.id + ',\'goal\',this.value)">' +
            goals.map(g => '<option value="' + g.v + '" ' + (e.goal===g.v?"selected":"") + '>' + g.l + '</option>').join("") +
          '</select>' +
        '</div>' +
        '<div class="exam-field full">' +
          '<label>Livello di preparazione attuale</label>' +
          '<select onchange="updateExam(' + e.id + ',\'level\',this.value)">' +
            levels.map(l => '<option value="' + l.v + '" ' + (e.level===l.v?"selected":"") + '>' + l.l + '</option>').join("") +
          '</select>' +
        '</div>' +
        '<div class="exam-field full">' +
          '<label>Argomenti che già padroneggi (facoltativo)</label>' +
          '<textarea placeholder="Elenca gli argomenti che hai già studiato bene. Studium li metterà nella fase di ripasso invece che nello studio da zero." oninput="updateExam(' + e.id + ',\'knownTopics\',this.value)">' + escapeHTML(e.knownTopics) + '</textarea>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("");
  updateStep2Btn();
}

function addExam() {
  state.exams.push({
    id: Date.now(),
    subject: "",
    date: "",
    type: "scritto",
    level: "nessuna preparazione",
    knownTopics: "",
    goal: "voto buono"
  });
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
  const fields = ["startDate","rest","context","stress","notes","hours","days"];
  fields.forEach(k => {
    const el = document.getElementById("pref-" + k);
    if (el) el.value = pref[k];
  });
  const hl = document.getElementById("hoursLabel");
  const dl = document.getElementById("daysLabel");
  if (hl) hl.textContent = pref.hours + "h";
  if (dl) dl.textContent = pref.days;
}

// ====== PLAN GENERATION ======
async function generatePlan() {
  // Cattura argomenti scritti a mano
  const manualEl = document.getElementById("manual-topics");
  if (manualEl) state.manualTopics = manualEl.value.trim();

  goToStep(4);
  const loadingEl = document.getElementById("loading-state");
  const contentEl = document.getElementById("plan-content");
  if (loadingEl) loadingEl.style.display = "block";
  if (contentEl) contentEl.style.display = "none";

  const stages = [
    "Analisi dei materiali in corso…",
    "Stima del volume di studio…",
    "Applicazione della curva dell'oblio…",
    "Calibrazione sull'obiettivo di voto…",
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
        manualTopics: state.manualTopics,
        files: state.files.map(f => ({ name: f.name, mimeType: f.mimeType, base64: f.base64 }))
      })
    });

    clearInterval(stageInt);

    if (res.status === 413) {
      throw new Error("I file caricati sono troppo grandi (max 3.5MB totali). Rimuovi o comprimi qualche file.");
    }
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
      errorBox.textContent = "Errore: " + err.message;
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
  html +=   '<button class="btn btn-primary" onclick="downloadPlanPDF()">↓ Scarica PDF</button>';
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
  state.manualTopics = "";
  state.exams = [{ id: 1, subject: "", date: "", type: "scritto", level: "nessuna preparazione", knownTopics: "", goal: "voto buono" }];
  state.prefs = { startDate: new Date().toISOString().split("T")[0], hours: 4, days: 6, rest: "domenica", context: "università", stress: "normale", notes: "" };
  state.plan = null;
  const mt = document.getElementById("manual-topics");
  if (mt) mt.value = "";
  renderFiles();
  renderExams();
  initPrefs();
  switchTab("files");
  goToStep(1);
}

// ====== DOWNLOAD PDF ======
function downloadPlanPDF() {
  const p = state.plan;
  if (!p) return;
  if (!window.jspdf) {
    alert("Libreria PDF non caricata. Ricarica la pagina e riprova.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 18;
  const marginTop = 20;
  const marginBottom = 18;
  const maxWidth = pageWidth - 2 * marginX;
  let y = marginTop;

  const colorDark = [28, 25, 23];
  const colorAccent = [180, 83, 9];
  const colorMuted = [120, 113, 108];

  function ensureSpace(needed) {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
  }

  function addText(text, size, style, color, leading) {
    if (!text) return;
    doc.setFontSize(size);
    doc.setFont("helvetica", style || "normal");
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(String(text), maxWidth);
    const lineHeight = leading || size * 0.45;
    lines.forEach(line => {
      ensureSpace(lineHeight);
      doc.text(line, marginX, y);
      y += lineHeight;
    });
  }

  function addDivider() {
    ensureSpace(6);
    doc.setDrawColor(200, 200, 195);
    doc.setLineWidth(0.2);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 6;
  }

  function addSpacer(mm) { y += mm; ensureSpace(0); }

  // === COPERTINA ===
  doc.setFillColor(28, 25, 23);
  doc.rect(0, 0, pageWidth, 60, "F");
  doc.setTextColor(250, 248, 243);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(28);
  doc.text("Studium", marginX, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("PIANO DI STUDIO PERSONALIZZATO · MMXXVI", marginX, 40);
  doc.setFontSize(8);
  doc.text("Generato il " + new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }), marginX, 48);

  y = 75;

  // === RIEPILOGO ===
  addText("RIEPILOGO", 9, "bold", colorMuted, 5);
  addSpacer(2);
  addText(p.summary || "", 11, "normal", colorDark, 5.5);
  addSpacer(6);

  // === STRATEGIA ===
  addText("STRATEGIA", 9, "bold", colorMuted, 5);
  addSpacer(2);
  addText(p.strategy || "", 11, "normal", colorDark, 5.5);
  addSpacer(6);

  // === FASI ===
  if (p.phases && p.phases.length) {
    addDivider();
    addText("LE FASI", 9, "bold", colorMuted, 5);
    addSpacer(3);
    p.phases.forEach((ph, i) => {
      ensureSpace(20);
      addText("Fase " + String(i+1).padStart(2, "0") + " — " + (ph.name || ""), 12, "bold", colorDark, 6);
      addText(ph.period || "", 8, "normal", colorAccent, 4);
      addSpacer(1);
      addText(ph.description || "", 10, "normal", colorDark, 5);
      addSpacer(4);
    });
    addSpacer(2);
  }

  // === CALENDARIO ===
  if (p.schedule && p.schedule.length) {
    addDivider();
    addText("CALENDARIO", 9, "bold", colorMuted, 5);
    addSpacer(4);

    p.schedule.forEach(d => {
      const isRest = d.isRest || !d.sessions || d.sessions.length === 0;
      ensureSpace(isRest ? 10 : 22);

      // Header giorno
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(colorDark[0], colorDark[1], colorDark[2]);
      const dayTitle = (d.dayName || "") + " — " + (d.date || "");
      doc.text(dayTitle, marginX, y);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(colorMuted[0], colorMuted[1], colorMuted[2]);
      const rightText = isRest ? "RIPOSO" : ((d.totalHours || 0) + "h di studio");
      doc.text(rightText, pageWidth - marginX, y, { align: "right" });
      y += 6;

      if (!isRest && d.sessions) {
        d.sessions.forEach(s => {
          ensureSpace(14);
          // Barretta colorata a sx
          doc.setDrawColor(colorAccent[0], colorAccent[1], colorAccent[2]);
          doc.setLineWidth(0.8);
          doc.line(marginX, y - 2, marginX, y + 10);

          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(colorDark[0], colorDark[1], colorDark[2]);
          const subjLine = (s.subject || "") + (s.duration ? "  (" + s.duration + ")" : "");
          doc.text(subjLine, marginX + 4, y + 1);
          y += 4.5;

          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          doc.setTextColor(colorDark[0], colorDark[1], colorDark[2]);
          const topicLines = doc.splitTextToSize(s.topic || "", maxWidth - 4);
          topicLines.forEach(line => {
            ensureSpace(4);
            doc.text(line, marginX + 4, y);
            y += 4;
          });

          doc.setFont("helvetica", "italic");
          doc.setFontSize(8.5);
          doc.setTextColor(colorMuted[0], colorMuted[1], colorMuted[2]);
          const metaText = (s.activity || "") + " · " + (s.goal || "");
          const metaLines = doc.splitTextToSize(metaText, maxWidth - 4);
          metaLines.forEach(line => {
            ensureSpace(4);
            doc.text(line, marginX + 4, y);
            y += 4;
          });
          y += 2;
        });
      }
      y += 3;
    });
  }

  // === CONSIGLI ===
  if (p.tips && p.tips.length) {
    addSpacer(3);
    addDivider();
    addText("CONSIGLI FINALI", 9, "bold", colorMuted, 5);
    addSpacer(3);
    p.tips.forEach((t, i) => {
      ensureSpace(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(colorAccent[0], colorAccent[1], colorAccent[2]);
      doc.text((i + 1) + ".", marginX, y);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(colorDark[0], colorDark[1], colorDark[2]);
      const lines = doc.splitTextToSize(t, maxWidth - 8);
      lines.forEach((line, li) => {
        ensureSpace(4.5);
        doc.text(line, marginX + 6, y);
        y += 4.5;
      });
      y += 2;
    });
  }

  // === FOOTER SU OGNI PAGINA ===
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(colorMuted[0], colorMuted[1], colorMuted[2]);
    doc.text("STUDIUM · Creato da Domenico Tortoriello · Ingegneria Elettrica, Federico II", marginX, pageHeight - 8);
    doc.text("Pag. " + i + " / " + total, pageWidth - marginX, pageHeight - 8, { align: "right" });
  }

  doc.save("studium-piano-di-studio.pdf");
}

// ====== ESPONI FUNZIONI GLOBALMENTE ======
window.showApp = showApp;
window.showLanding = showLanding;
window.goToStep = goToStep;
window.addExam = addExam;
window.removeExam = removeExam;
window.updateExam = updateExam;
window.removeFile = removeFile;
window.generatePlan = generatePlan;
window.downloadPlanPDF = downloadPlanPDF;
window.resetAll = resetAll;
window.switchTab = switchTab;

// ====== INIT ON DOM READY ======
document.addEventListener("DOMContentLoaded", function() {
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

  const mtInput = document.getElementById("manual-topics");
  if (mtInput) mtInput.addEventListener("input", e => { state.manualTopics = e.target.value; });
});
