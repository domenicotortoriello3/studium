// Serverless function per Vercel - MODIFICA DI UN PIANO ESISTENTE
// Riceve il PDF del piano precedente + le modifiche richieste, rigenera il piano

export const config = { maxDuration: 60 };

const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + RATE_LIMIT_WINDOW; }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  rateLimitMap.set(ip, record);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo non consentito" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.headers["x-real-ip"] || "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Troppe richieste. Riprova tra un'ora." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "API key non configurata" });

  try {
    const { oldPlanPdf, changes } = req.body || {};
    if (!oldPlanPdf || !oldPlanPdf.base64) return res.status(400).json({ error: "Manca il PDF del piano precedente" });
    if (!changes || !changes.trim()) return res.status(400).json({ error: "Manca la descrizione delle modifiche" });

    const today = new Date().toISOString().split("T")[0];

    const userMessage = `Data odierna: ${today}

Qui sotto trovi il PDF del PIANO DI STUDIO PRECEDENTE generato da Studium, e le MODIFICHE che lo studente vuole applicare. Il tuo compito è rigenerare un piano aggiornato che:

1. **Parte dal piano vecchio**: leggilo attentamente e estrai materie, esami, date, argomenti, strategia originale, fase corrente
2. **Applica le modifiche richieste**: interpretale e rifletti sulle conseguenze
3. **Ricalibra il metodo Studium**: spaced repetition, active recall, interleaving — come sempre
4. **Considera cosa è già stato fatto**: se lo studente dice "sono a giorno 5", non rifare dallo studio iniziale; se dice "ho già fatto il capitolo 3", mettilo solo in ripasso

COSA È CAMBIATO / DA AGGIORNARE (parole dello studente):
"""
${changes.trim()}
"""

Rispondi SOLO in JSON, senza markdown, senza backticks, senza preamboli.`;

    const contentBlocks = [
      { type: "text", text: userMessage },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: oldPlanPdf.base64 } }
    ];

    const systemPrompt = `Sei Studium, un tutor accademico scientifico italiano. In questa modalità stai RIGENERANDO un piano esistente in base alle modifiche dello studente.

## COSA FARE PRIMA DI TUTTO

1. Leggi il PDF del piano precedente con attenzione: materie, esami, date, argomenti specifici, fase corrente.
2. Leggi cosa chiede lo studente. Interpreta correttamente:
   - "Esame spostato dal X al Y" → sposta tutte le date del calendario di conseguenza
   - "Sono indietro di N giorni" → ricalcola da oggi, accorciando il piano
   - "Ho già fatto X" → togli X dallo studio iniziale, mettilo solo nei ripassi
   - "Il professore ha aggiunto Y" → integra Y nel programma
   - "Aumento/diminuisco le ore" → ridimensiona sessioni
   - "Mi sento pronto su X" → sposta X solo in ripasso veloce
3. Applica il metodo Studium al nuovo calendario.

## METODO STUDIUM (applicalo SEMPRE)

- Ripetizione dilazionata (ripassi a ~1, 3, 7, 14 giorni)
- Richiamo attivo (obiettivi di autoverifica espliciti per ogni sessione)
- Interleaving (alterna argomenti/materie)
- Calibrazione al volume reale
- Buffer 10-15%
- Ultima settimana: solo ripasso e simulazioni
- Onestà brutale: se dopo le modifiche il piano è impossibile, dillo nel summary

## STILE

- Tutor esigente ma umano, no chatbot, no emoji
- Specificità maniacale: nome argomento, pagine, obiettivo concreto
- Adatta il tono al contesto (se lo studente è indietro, sii tattico)

## OUTPUT — JSON OBBLIGATORIO

Rispondi ESCLUSIVAMENTE in JSON valido:

{
  "summary": "2-3 frasi su cosa è cambiato e sul realismo del nuovo piano",
  "strategy": "5-7 frasi sulla nuova strategia: cosa hai spostato, cosa hai tagliato, come gestisci ora l'obiettivo",
  "phases": [{"name": "...", "period": "dal X al Y", "description": "..."}],
  "schedule": [
    {
      "date": "YYYY-MM-DD",
      "dayName": "Lunedì",
      "isRest": false,
      "totalHours": 4,
      "sessions": [
        {"subject": "...", "topic": "...", "duration": "2h", "activity": "...", "goal": "..."}
      ]
    }
  ],
  "tips": ["...", "...", "..."]
}

Il calendario deve coprire da oggi (${today}) fino al giorno prima dell'ultimo esame.`;

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
    const textResponse = (data.content || []).map(b => b.type === "text" ? b.text : "").join("\n").trim();
    let cleanText = textResponse.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const firstBrace = cleanText.indexOf("{");
    const lastBrace = cleanText.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1) cleanText = cleanText.slice(firstBrace, lastBrace + 1);

    let plan;
    try { plan = JSON.parse(cleanText); }
    catch (e) {
      console.error("JSON parse:", e, textResponse.slice(0, 500));
      return res.status(502).json({ error: "Risposta dell'AI non valida. Riprova." });
    }

    return res.status(200).json({ plan });

  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).json({ error: "Errore interno. Riprova tra poco." });
  }
}
