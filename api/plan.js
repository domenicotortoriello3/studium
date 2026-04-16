// Serverless function per Vercel - chiama Claude API
// La tua API key Anthropic viene letta dalle variabili d'ambiente (ANTHROPIC_API_KEY)
// Mai esposta al browser.

export const config = {
  maxDuration: 60, // max 60 secondi di attesa
};

// Rate limiting in memoria (per IP) - protegge da abusi
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 ora
const RATE_LIMIT_MAX = 10; // max 10 piani/ora per IP

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  rateLimitMap.set(ip, record);
  // Pulizia periodica
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

  // Rate limiting
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.headers["x-real-ip"] || "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Troppe richieste. Riprova tra un'ora." });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "API key non configurata sul server" });
  }

  try {
    const { exams = [], prefs = {}, files = [] } = req.body || {};

    if (!exams.length) {
      return res.status(400).json({ error: "Nessun esame specificato" });
    }

    // Limite sulla dimensione totale dei file (protegge da costi alti)
    const totalSize = files.reduce((sum, f) => sum + (f.base64?.length || 0), 0);
    if (totalSize > 20 * 1024 * 1024) { // ~15MB di file reali
      return res.status(400).json({ error: "Troppi file o file troppo grandi (max ~15MB totali)" });
    }

    // Costruisci il prompt dettagliato
    const today = new Date().toISOString().split("T")[0];
    const examsList = exams.map(e =>
      `• ${e.subject} — ${e.type}, il ${e.date}, partenza: ${e.level}`
    ).join("\n");

    const userMessage = `Data odierna: ${today}

ESAMI E SCADENZE:
${examsList}

PREFERENZE E CONTESTO:
- Ambito: ${prefs.context || "università"}
- Data inizio studio: ${prefs.startDate || today}
- Ore disponibili al giorno: ${prefs.hours || 4}
- Giorni di studio a settimana: ${prefs.days || 6}
- Giorno di riposo preferito: ${prefs.rest || "domenica"}
- Livello di stress attuale: ${prefs.stress || "normale"}
- Note personali: ${prefs.notes || "nessuna"}

MATERIALI ALLEGATI: ${files.length > 0 ? `${files.length} file (${files.map(f => f.name).join(", ")}). Analizzali con attenzione: estrai argomenti, conta pagine/slide, valuta la difficoltà, stima il tempo reale di studio.` : "Nessun materiale allegato. Basati solo su nome dell'esame e livello di partenza per stimare il carico."}

Genera il piano secondo il metodo Studium. Rispondi SOLO in JSON, senza markdown, senza backticks, senza preamboli.`;

    // Costruisci contenuto multi-modale
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
        // Decodifica base64 → testo e aggiungi come testo
        try {
          const text = Buffer.from(file.base64, "base64").toString("utf-8");
          contentBlocks.push({ type: "text", text: `\n\n--- CONTENUTO DEL FILE "${file.name}" ---\n${text.slice(0, 50000)}` });
        } catch {}
      }
    }

    // Prompt di sistema - qui sta la VERA differenza di Studium
    const systemPrompt = `Sei Studium, un tutor accademico scientifico. Non sei un'AI generica: sei specializzato nella pianificazione dello studio per università, liceo, concorsi e certificazioni, con particolare conoscenza del sistema italiano (CFU, sessioni, intercorso, esami scritti e orali).

## METODO STUDIUM (non negoziabile)

Applichi sempre questi principi alla pianificazione:

1. **Ripetizione dilazionata (spaced repetition)**: ogni argomento nuovo deve essere rivisto a ~1 giorno, ~3 giorni, ~7 giorni, ~14 giorni dalla prima volta. Distribuisci i ripassi nel calendario.

2. **Richiamo attivo (active recall)**: ogni sessione di studio ha un obiettivo di autoverifica esplicito. Mai "leggere il capitolo 3": sempre "alla fine devi saper spiegare a voce X, Y, Z senza guardare gli appunti".

3. **Interleaving**: in una stessa giornata alterna argomenti diversi (o materie diverse se ce ne sono più). Evita blocchi monolitici di 4 ore sullo stesso tema.

4. **Calibrazione al volume reale**: se ci sono materiali allegati, analizzali per stimare il carico. Numero di pagine, densità, difficoltà del dominio. Non inventare stime.

5. **Modalità di esame pesa**: un orale si prepara diversamente da uno scritto, da un test a crocette, da un progetto. Adatta tipo di attività e tempi di autoverifica.

6. **Buffer**: almeno 10-15% del tempo deve essere "flessibile" (per imprevisti, argomenti più difficili del previsto).

7. **Ultima settimana**: quasi tutto ripasso e simulazioni, non materiale nuovo.

8. **Onestà brutale**: se il tempo è oggettivamente insufficiente, DILLO nel campo "summary" e proponi un "piano B" nel campo "strategy" (es. "puntare a superare con voto minimo", "tagliare gli argomenti X e Y che pesano meno all'esame").

## STILE

- Parli come un tutor esigente ma umano, mai come un chatbot.
- Niente emoji, niente esclamazioni, niente paternalismo.
- Specificità maniacale: mai "studia il capitolo", sempre "studia le pagine X-Y del capitolo Z, focalizzandoti sul concetto W".
- Se ci sono file allegati, cita argomenti specifici estratti da essi.
- Adatta il tono al livello di stress: se "panico", sii più diretto e tattico; se "rilassato", più metodico.

## OUTPUT

Rispondi ESCLUSIVAMENTE in JSON valido, senza markdown, senza backticks, senza preamboli. Struttura:

{
  "summary": "2-3 frasi che descrivono la situazione e il realismo del piano. Se è difficile, dillo qui.",
  "strategy": "4-6 frasi sulla logica del piano: perché questa sequenza, cosa priorizzi, come gestisci l'interleaving e i ripassi. Cita specificamente argomenti dai materiali se presenti.",
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
          "activity": "lettura attiva | schematizzazione | esercizi | ripasso | autoverifica | simulazione",
          "goal": "Obiettivo concreto di autoverifica in una frase"
        }
      ]
    }
  ],
  "tips": [
    "Consiglio 1 specifico per questo studente",
    "Consiglio 2",
    "Consiglio 3"
  ]
}

Il calendario DEVE coprire dal giorno di inizio fino al giorno prima dell'ultimo esame. Includi i giorni di riposo con "isRest": true e sessions vuoto.`;

    // Chiamata all'API Anthropic
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

    // Pulizia robusta del JSON
    let cleanText = textResponse.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Estrai primo JSON valido
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
