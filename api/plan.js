// Serverless function per Vercel - chiama Claude API
// La tua API key Anthropic viene letta dalle variabili d'ambiente (ANTHROPIC_API_KEY)

export const config = { maxDuration: 60 };

// Rate limiting in memoria (per IP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 ora
const RATE_LIMIT_MAX = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + RATE_LIMIT_WINDOW; }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  rateLimitMap.set(ip, record);
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.headers["x-real-ip"] || "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Troppe richieste. Riprova tra un'ora." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key non configurata sul server" });
  }

  try {
    const { exams = [], prefs = {}, files = [], manualTopics = "" } = req.body || {};

    if (!exams.length) {
      return res.status(400).json({ error: "Nessun esame specificato" });
    }

    const totalSize = files.reduce((sum, f) => sum + (f.base64?.length || 0), 0);
    if (totalSize > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "File troppo grandi (max ~3.5MB totali)" });
    }

    const today = new Date().toISOString().split("T")[0];

    // Mapping obiettivi di voto → strategia
    const goalStrategy = {
      "massimo dei voti": "Punta all'eccellenza. Copri tutto il programma con profondità. Fai collegamenti trasversali. Prepara risposte articolate e esempi per ogni argomento. Prevedi ampio tempo per approfondimenti e letture consigliate.",
      "voto alto": "Copri tutto il programma con buona profondità. Focus su comprensione concettuale e applicazione. Prevedi esercitazioni e simulazioni.",
      "voto buono": "Copri l'intero programma a livello solido. Non servono approfondimenti specialistici ma la base deve essere sicura.",
      "voto sufficiente": "Identifica gli argomenti fondamentali (80% della probabilità d'esame) e padroneggiali bene. Gli argomenti secondari puoi toccarli superficialmente.",
      "solo passare": "Strategia di sopravvivenza: individua gli argomenti irrinunciabili (quelli che 'cadono sempre') e puntaci tutto. Gli argomenti minori vanno lasciati da parte o visti solo superficialmente. Meglio padroneggiare poco che sapere tutto male."
    };

    const examsList = exams.map((e, i) => {
      let block = `ESAME ${i+1} — ${e.subject}`;
      block += `\n  • Data: ${e.date}`;
      block += `\n  • Modalità: ${e.type}`;
      block += `\n  • Livello di preparazione attuale: ${e.level}`;
      block += `\n  • Obiettivo di voto: ${e.goal}`;
      block += `\n  • Strategia per l'obiettivo: ${goalStrategy[e.goal] || ""}`;
      if (e.knownTopics && e.knownTopics.trim()) {
        block += `\n  • Argomenti GIÀ padroneggiati (da mettere solo in ripasso, non studio da zero):\n    ${e.knownTopics.trim().split("\n").map(l => "    " + l).join("\n")}`;
      }
      return block;
    }).join("\n\n");

    const userMessage = `Data odierna: ${today}

${examsList}

PREFERENZE E CONTESTO DELLO STUDENTE:
- Ambito: ${prefs.context || "università"}
- Data inizio studio: ${prefs.startDate || today}
- Ore disponibili al giorno: ${prefs.hours || 4}
- Giorni di studio a settimana: ${prefs.days || 6}
- Giorno di riposo preferito: ${prefs.rest || "domenica"}
- Livello di stress attuale: ${prefs.stress || "normale"}
- Note personali: ${prefs.notes || "nessuna"}

MATERIALI ALLEGATI: ${files.length > 0 ? `${files.length} file (${files.map(f => f.name).join(", ")}). Analizzali con attenzione: estrai argomenti, conta pagine/slide, valuta la difficoltà, stima il tempo reale di studio.` : "Nessun file allegato."}

${manualTopics ? `ARGOMENTI SCRITTI A MANO DALLO STUDENTE:\n${manualTopics}\n\nQuesti sono gli argomenti che lo studente ha elencato direttamente. Usali come indice del programma da studiare se non ci sono file, o come integrazione se ci sono file.` : ""}

Genera il piano secondo il metodo Studium. Rispondi SOLO in JSON, senza markdown, senza backticks, senza preamboli.`;

    // Content blocks multimodali
    const contentBlocks = [{ type: "text", text: userMessage }];

    for (const file of files) {
      if (!file.base64) continue;
      if (file.mimeType === "application/pdf") {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: file.base64 }
        });
      } else if (file.mimeType?.startsWith("image/")) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: file.mimeType, data: file.base64 }
        });
      } else if (file.mimeType?.startsWith("text/") || file.name.endsWith(".md") || file.name.endsWith(".txt")) {
        try {
          const text = Buffer.from(file.base64, "base64").toString("utf-8");
          contentBlocks.push({ type: "text", text: `\n--- CONTENUTO DEL FILE "${file.name}" ---\n${text.slice(0, 50000)}` });
        } catch {}
      }
    }

    // ==================================================================
    // SYSTEM PROMPT — qui è codificato il DNA di Studium.
    // ==================================================================
    const systemPrompt = `Sei Studium, un tutor accademico scientifico italiano. Non sei un'AI generica: sei specializzato nella pianificazione dello studio per università, liceo, concorsi e certificazioni, con conoscenza approfondita del sistema italiano (CFU, sessioni, intercorso, scritti e orali, modalità d'esame comuni per materia).

## METODO STUDIUM (non negoziabile)

1. **Ripetizione dilazionata (spaced repetition)**: ogni argomento nuovo deve essere rivisto a ~1 giorno, ~3 giorni, ~7 giorni, ~14 giorni dalla prima volta. Distribuisci i ripassi nel calendario esplicitamente — quando pianifichi un ripasso, indicalo come "ripasso" nell'attività.

2. **Richiamo attivo (active recall)**: ogni sessione di studio ha un obiettivo di autoverifica esplicito e concreto. Mai "leggere il capitolo 3": sempre "alla fine devi saper spiegare a voce X, Y, Z senza guardare gli appunti".

3. **Interleaving**: in una stessa giornata alterna argomenti diversi (o materie diverse se ce ne sono più). Evita blocchi monolitici di 4 ore sullo stesso tema.

4. **Calibrazione al volume reale**: se ci sono materiali allegati o argomenti scritti dallo studente, analizzali per stimare il carico. Numero di pagine, densità, difficoltà. Non inventare stime.

5. **Modalità d'esame pesa**: un orale si prepara con ripetizioni a voce alta e costruzione di discorsi; uno scritto con esercizi e simulazioni; un test a crocette con tanti quiz; un progetto con iterazioni. Adatta l'attività.

6. **Buffer**: almeno 10-15% del tempo deve essere "flessibile" per imprevisti.

7. **Ultima settimana**: solo ripasso, simulazioni, autoverifiche. NIENTE materiale nuovo.

## OBIETTIVO DI VOTO — LEGGILO BENE

Lo studente ti ha dichiarato un obiettivo di voto per OGNI esame. Questo cambia RADICALMENTE il piano:

- **"massimo dei voti"** → copertura totale + approfondimenti. Sessioni più lunghe. Esempi multipli per ogni concetto. Letture aggiuntive. Simulazioni intensive.
- **"voto alto"** → copertura completa con buona profondità. Non serve l'eccellenza su tutto.
- **"voto buono"** → copertura completa ma solida, senza approfondimenti specialistici.
- **"voto sufficiente"** → identifica i temi chiave (80% della probabilità d'esame) e padroneggiali. Gli argomenti secondari vanno toccati ma non approfonditi.
- **"solo passare"** → strategia di sopravvivenza. Individua gli argomenti irrinunciabili e mettici tutto. Argomenti minori: esposizione rapida o addirittura esclusione. Diglielo apertamente nella strategia.

## ARGOMENTI GIÀ PADRONEGGIATI

Se lo studente elenca argomenti che già conosce, NON metterli in "studio da zero". Mettili solo nelle sessioni di ripasso per consolidare. Questo libera tempo prezioso.

## ONESTÀ BRUTALE

Se il tempo è oggettivamente insufficiente per l'obiettivo dichiarato, DIGLIELO chiaramente nel campo "summary". Proponi un "piano B" nel campo "strategy": quali argomenti tagliare, ridimensionare l'obiettivo di voto, studiare di più al giorno. Non mentire per farlo sentire bene.

## STILE

- Parli come un tutor esigente ma umano, mai come un chatbot.
- Niente emoji, niente esclamazioni, niente paternalismo.
- Specificità maniacale: mai "studia il capitolo", sempre "studia pagine X-Y del capitolo Z, focalizzandoti sul concetto W".
- Se ci sono file allegati o argomenti scritti, CITA argomenti specifici estratti da essi. Mostra che li hai davvero letti.
- Adatta tono al livello di stress: "panico" → diretto e tattico; "rilassato" → metodico.

## OUTPUT — JSON OBBLIGATORIO

Rispondi ESCLUSIVAMENTE in JSON valido, senza markdown, senza backticks, senza preamboli:

{
  "summary": "2-3 frasi che descrivono la situazione, l'obiettivo dichiarato e il realismo del piano. Se è difficile raggiungere il voto obiettivo, dillo qui.",
  "strategy": "5-7 frasi sulla logica del piano: come gestisci l'obiettivo di voto, cosa priorizzi, come usi l'interleaving e i ripassi, cosa tagli o approfondisci. Cita specificamente argomenti dai materiali/testi.",
  "phases": [
    {"name": "Fase 1 — Fondazioni", "period": "dal X al Y", "description": "cosa succede in questa fase"},
    {"name": "Fase 2 — Approfondimento", "period": "dal X al Y", "description": "..."},
    {"name": "Fase 3 — Consolidamento e simulazioni", "period": "dal X al Y", "description": "..."}
  ],
  "schedule": [
    {
      "date": "YYYY-MM-DD",
      "dayName": "Lunedì",
      "isRest": false,
      "totalHours": 4,
      "sessions": [
        {
          "subject": "Nome materia",
          "topic": "Argomento specifico (pagine/slide se disponibili)",
          "duration": "2h",
          "activity": "lettura attiva | schematizzazione | esercizi | ripasso | autoverifica | simulazione | lettura ad alta voce",
          "goal": "Obiettivo concreto di autoverifica in una frase"
        }
      ]
    }
  ],
  "tips": ["Consiglio 1 specifico", "Consiglio 2", "Consiglio 3"]
}

Il calendario DEVE coprire dal giorno di inizio fino al giorno prima dell'ultimo esame. Includi i giorni di riposo con "isRest": true e sessions vuoto.`;

    // Chiamata API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: "user", content: contentBlocks }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.status(502).json({ error: "Errore dell'AI. Riprova tra poco." });
    }

    const data = await response.json();
    const textResponse = (data.content || [])
      .map(b => b.type === "text" ? b.text : "")
      .join("\n")
      .trim();

    let cleanText = textResponse.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const firstBrace = cleanText.indexOf("{");
    const lastBrace = cleanText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanText = cleanText.slice(firstBrace, lastBrace + 1);
    }

    let plan;
    try {
      plan = JSON.parse(cleanText);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "raw:", textResponse.slice(0, 500));
      return res.status(502).json({ error: "Risposta dell'AI non valida. Riprova." });
    }

    return res.status(200).json({ plan });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Errore interno. Riprova tra poco." });
  }
}
