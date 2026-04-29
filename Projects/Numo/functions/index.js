const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const OpenAI = require("openai");
const cors = require("cors");
const { SYSTEM_PROMPT } = require("./systemPrompt");

admin.initializeApp();
const db = admin.firestore();

// CORS middleware
const corsHandler = cors({ origin: true });

// Initialize Cerebras client (OpenAI-compatible) — large model, high TPM
const cerebras = new OpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY || "",
});

// ============ MEMORY CONFIG ============
const PRIMARY_MODEL = "qwen-3-235b-a22b-instruct-2507";
const FALLBACK_MODEL = "llama3.1-8b";
const RECENT_MESSAGES_KEPT = 6;            // verbatim history kept in prompt
const SUMMARY_TRIGGER_THRESHOLD = 6;       // re-summarize once this many new old-msgs accumulate
const TOP_K_FACTS = 3;                      // semantic facts to inject per turn
const FACT_RELEVANCE_FLOOR = 0.55;          // cosine sim cutoff for BGE-small
const EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";  // 384-dim, free on HF Inference

// ============ MEMORY HELPERS ============

async function embedText(text) {
  const hfToken = process.env.HF_TOKEN || "";
  if (!hfToken || !text) return null;
  try {
    // HF moved to the inference router in 2025; legacy /models/* path is gone.
    const res = await fetch(
      `https://router.huggingface.co/hf-inference/models/${EMBEDDING_MODEL}/pipeline/feature-extraction`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hfToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: text.slice(0, 2000) }),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[memory] HF embed ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch (e) {
    console.warn("[memory] embed failed:", e.message);
    return null;
  }
}

// Slim prompt used when we fall back to llama3.1-8b (8K context). The full SYSTEM_PROMPT
// would overflow, so we keep only persona + format rules and lean entirely on the
// userFacts block (which the model is already told to trust) for chart specifics.
const SLIM_SYSTEM_PROMPT = `You are Numo, a numerology assistant practicing the Sankar method (a blend of Vedic, Chinese, Chaldean, and Cheiro traditions).

The user's chart numbers are provided below in a CURRENT USER FACTS block — trust them exactly and do NOT recompute. Pilot = driving energy (from birth day), Co-Pilot = life path (full DOB digit-sum), Flight Attendant = Kua number (year-based, gender-modified).

Style rules (strict):
- Warm, plain English — no tables, no arithmetic, no ASCII grids, no star ratings.
- Open with 1-2 sentences in plain language naming what's going on.
- Add one short analysis paragraph grounded in the user's actual numbers.
- End with "### Action items" — 2-4 bold bullets, each with a one-sentence "why".
- Ground every answer in the user's chart. Be specific, not generic.`;

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

async function retrieveRelevantFacts(sessionRef, queryText, k) {
  const queryEmbedding = await embedText(queryText);
  if (!queryEmbedding) return [];
  const factsSnap = await sessionRef.collection("facts").get();
  if (factsSnap.empty) return [];
  const scored = [];
  factsSnap.docs.forEach((doc) => {
    const f = doc.data();
    if (!f.embedding || !Array.isArray(f.embedding)) return;
    scored.push({ text: f.text, score: cosineSim(queryEmbedding, f.embedding) });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).filter((s) => s.score > FACT_RELEVANCE_FLOOR);
}

async function extractAndSaveFacts(sessionRef, userMsg, assistantMsg) {
  try {
    const prompt = `From the exchange below, extract 0-3 short durable facts about the USER (their goals, life situation, relationships, recurring concerns, stated preferences). Each fact must be a single self-contained sentence under 25 words. Skip transient questions, calculations, generic advice. Return ONLY a JSON array of strings. Empty array [] if nothing durable.

USER: ${userMsg}
NUMO: ${(assistantMsg || "").slice(0, 1500)}

JSON:`;
    const completion = await cerebras.chat.completions.create({
      model: FALLBACK_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 250,
    });
    const content = completion.choices[0]?.message?.content || "[]";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return;
    let facts;
    try { facts = JSON.parse(match[0]); } catch { return; }
    if (!Array.isArray(facts) || facts.length === 0) return;

    for (const factText of facts.slice(0, 3)) {
      if (typeof factText !== "string" || factText.trim().length < 8) continue;
      const embedding = await embedText(factText);
      if (!embedding) continue;
      await sessionRef.collection("facts").add({
        text: factText.trim(),
        embedding,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (e) {
    console.warn("[memory] fact extraction failed:", e.message);
  }
}

async function maybeUpdateSummary(sessionRef, sessionData) {
  try {
    const allSnap = await sessionRef
      .collection("messages")
      .orderBy("timestamp", "asc")
      .get();
    const total = allSnap.size;
    if (total <= RECENT_MESSAGES_KEPT + 1) return;

    const summarizedCount = sessionData.summarizedCount || 0;
    const olderCutoff = total - RECENT_MESSAGES_KEPT;
    if (olderCutoff - summarizedCount < SUMMARY_TRIGGER_THRESHOLD) return;

    // Only feed the NEW older messages into the summarizer; previous summary carries the rest.
    const newOlderDocs = allSnap.docs.slice(summarizedCount, olderCutoff);
    const transcript = newOlderDocs.map((d) => {
      const m = d.data();
      return `${m.role === "user" ? "User" : "Numo"}: ${(m.content || "").slice(0, 600)}`;
    }).join("\n");

    const previousSummary = sessionData.summary || "";
    const prompt = `You are maintaining a memory summary of an ongoing numerology consultation. Produce a tight ≤200-word summary in plain prose (no bullets) capturing: the user's situation, recurring themes, key advice already given, and any decisions/commitments. Merge the previous summary with the new transcript — do not duplicate facts.

${previousSummary ? `PREVIOUS SUMMARY:\n${previousSummary}\n\n` : ""}NEW TRANSCRIPT:
${transcript}

UPDATED SUMMARY:`;

    const completion = await cerebras.chat.completions.create({
      model: FALLBACK_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
    });
    const summary = completion.choices[0]?.message?.content?.trim();
    if (!summary) return;

    await sessionRef.update({
      summary,
      summarizedCount: olderCutoff,
      summaryUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn("[memory] summary update failed:", e.message);
  }
}

/**
 * Main chat endpoint
 * POST /numoChat
 * Body: { message, sessionId, userDob, userName, userGender }
 * Returns: SSE stream of assistant response
 */
exports.numoChat = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: ["CEREBRAS_API_KEY", "HF_TOKEN"],
  },
  (req, res) => {
    corsHandler(req, res, async () => {
      // Handle preflight
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      try {
        const {
          message,
          sessionId,
          userDob,
          userName,
          userGender,
          userFacts,
          toolContext,
        } = req.body;

        if (!message || !sessionId) {
          res.status(400).json({ error: "message and sessionId are required" });
          return;
        }

        // Get or create session
        const sessionRef = db.collection("numo_sessions").doc(sessionId);
        const sessionDoc = await sessionRef.get();
        const sessionData = sessionDoc.exists ? sessionDoc.data() : {};

        if (!sessionDoc.exists && userDob) {
          await sessionRef.set({
            userName: userName || "Friend",
            userDob: userDob,
            userGender: userGender || "unknown",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        // Load recent messages (verbatim window)
        const messagesSnap = await sessionRef
          .collection("messages")
          .orderBy("timestamp", "desc")
          .limit(RECENT_MESSAGES_KEPT)
          .get();

        const history = [];
        messagesSnap.docs.reverse().forEach((doc) => {
          const data = doc.data();
          history.push({ role: data.role, content: data.content });
        });

        // Retrieve relevant facts in parallel; cap retrieval at 1.5s so it never stalls the response.
        const facts = await Promise.race([
          retrieveRelevantFacts(sessionRef, message, TOP_K_FACTS),
          new Promise((resolve) => setTimeout(() => resolve([]), 1500)),
        ]);

        // Build memory context (summary + relevant facts) — placed BEFORE userContext so the
        // model sees long-term memory first, current snapshot second.
        let memoryContext = "";
        if (sessionData.summary) {
          memoryContext += `\n\n═══ EARLIER CONVERSATION SUMMARY ═══\n${sessionData.summary}\n═══════════════════════════════════════════════\n`;
        }
        if (facts.length > 0) {
          memoryContext += `\n\n═══ RELEVANT REMEMBERED FACTS ═══\n`;
          facts.forEach((f) => { memoryContext += `- ${f.text}\n`; });
          memoryContext += `═══════════════════════════════════════════════\n`;
        }

        // Build user context: prefer the precomputed facts block (deterministic)
        // over asking the model to recompute.
        let userContext = "";
        if (userFacts && typeof userFacts === "object") {
          userContext += "\n\n═══ CURRENT USER FACTS (trust these, do not recompute) ═══\n";
          userContext += `Name: ${userName || "Friend"}\n`;
          userContext += `First name: ${(userName || "Friend").split(" ")[0]}\n`;
          userContext += `Date of Birth: ${userDob || "unknown"}\n`;
          userContext += `Gender: ${userGender || "unspecified"}\n`;
          userContext += `Pilot (driving energy): ${userFacts.pilot}\n`;
          userContext += `Co-Pilot (life path): ${userFacts.coPilot}\n`;
          userContext += `Flight Attendant (Kua): ${userFacts.fa}\n`;
          userContext += `Birth-day category: ${userFacts.dayCategory || "—"}\n`;
          userContext += `Numbers present in chart: ${userFacts.presentNumbers || "—"}\n`;
          userContext += `Missing numbers: ${userFacts.missingNumbers || "none"}\n`;
          userContext += `Number repetitions: ${userFacts.repetitions || "—"}\n`;
          userContext += `Active planes (complete): ${userFacts.completePlanes || "none"}\n`;
          userContext += `Partial planes (66%): ${userFacts.partialPlanes || "none"}\n`;
          userContext += `Raj Yogas active: ${userFacts.rajYogas || "none"}\n`;
          userContext += `Karmic flag: ${userFacts.karmic || "none"}\n`;
          userContext += `Master number flag: ${userFacts.master || "none"}\n`;
          userContext += `Lucky numbers: ${userFacts.luckyNumbers || "—"}\n`;
          userContext += `Bad numbers: ${userFacts.badNumbers || "—"}\n`;
          userContext += `P-CP combination read: ${userFacts.pcpRead || "—"}\n`;
          userContext += `Personal Year (current): ${userFacts.personalYear}\n`;
          userContext += `Personal Month (current): ${userFacts.personalMonth || "—"}\n`;
          userContext += `Personal Day (today): ${userFacts.personalDay || "—"}\n`;
          if (userFacts.notes) userContext += `Notes: ${userFacts.notes}\n`;
          userContext += "═══════════════════════════════════════════════\n";
        } else if (userDob) {
          // Legacy fallback if a client doesn't send precomputed facts
          userContext = `\n\nCURRENT USER INFO:\nName: ${userName || "Not provided"}\nDate of Birth: ${userDob}\nGender: ${userGender || "Not specified"}\n\nCalculate their Pilot, Co-Pilot, and Flight Attendant numbers from this DOB and use them in all readings.`;
        }

        if (toolContext && typeof toolContext === "object") {
          userContext += "\n\n═══ TOOL CONTEXT FOR THIS QUESTION ═══\n";
          userContext += `Tool: ${toolContext.tool || "—"}\n`;
          for (const [k, v] of Object.entries(toolContext)) {
            if (k === "tool") continue;
            userContext += `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}\n`;
          }
          userContext += "═══════════════════════════════════════\n";
        }

        // Build messages array for Cerebras
        const messages = [
          { role: "system", content: SYSTEM_PROMPT + memoryContext + userContext },
          ...history,
          { role: "user", content: message },
        ];

        // Set up SSE streaming
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Try primary (Qwen 235B); fall back to llama3.1-8b on rate-limit / 5xx so the user
        // gets *some* answer instead of a 500.
        let stream;
        let modelUsed = PRIMARY_MODEL;
        try {
          stream = await cerebras.chat.completions.create({
            model: PRIMARY_MODEL,
            messages,
            temperature: 0.7,
            max_tokens: 2048,
            stream: true,
          });
        } catch (primaryErr) {
          const status = primaryErr.status;
          console.warn(`[${requestId}] primary model ${PRIMARY_MODEL} failed (status=${status} type=${primaryErr.type || "?"}): ${primaryErr.message}`);
          if (status === 429 || (status >= 500 && status < 600)) {
            modelUsed = FALLBACK_MODEL;
            // Rebuild messages with slim prompt — full SYSTEM_PROMPT overflows llama3.1-8b's 8K window.
            const slimMessages = [
              { role: "system", content: SLIM_SYSTEM_PROMPT + memoryContext + userContext },
              ...history,
              { role: "user", content: message },
            ];
            stream = await cerebras.chat.completions.create({
              model: FALLBACK_MODEL,
              messages: slimMessages,
              temperature: 0.7,
              max_tokens: 1500,
              stream: true,
            });
            console.info(`[${requestId}] fell back to ${FALLBACK_MODEL} with slim prompt`);
          } else {
            throw primaryErr;
          }
        }

        let fullResponse = "";
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }

        res.write(`data: ${JSON.stringify({ done: true, model: modelUsed })}\n\n`);
        res.end();

        // ===== Post-response memory work (run after end() so user perceives no extra latency) =====
        try {
          // 1. Persist this turn
          const batch = db.batch();
          const userMsgRef = sessionRef.collection("messages").doc();
          batch.set(userMsgRef, {
            role: "user",
            content: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          const assistantMsgRef = sessionRef.collection("messages").doc();
          batch.set(assistantMsgRef, {
            role: "assistant",
            content: fullResponse,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          await batch.commit();

          // 2. Async: extract facts + maybe-roll summary, in parallel.
          //    Settled-not-thrown so one failure doesn't kill the other.
          await Promise.allSettled([
            extractAndSaveFacts(sessionRef, message, fullResponse),
            maybeUpdateSummary(sessionRef, sessionData),
          ]);
        } catch (memErr) {
          console.warn(`[${requestId}] post-response memory write failed:`, memErr.message);
        }
      } catch (error) {
        // Structured error log — easier to grep, includes status + type + request id
        const errDetails = {
          requestId,
          message: error.message,
          status: error.status,
          code: error.code,
          type: error.type,
          stack: (error.stack || "").split("\n").slice(0, 5).join(" | "),
        };
        console.error("[numoChat] error:", JSON.stringify(errDetails));

        if (!res.headersSent) {
          const userMessage = error.status === 429
            ? "Numo is busy right now. Please try again in a moment."
            : "Something went wrong. Please try again.";
          res.status(500).json({
            error: userMessage,
            requestId,
            details: process.env.NODE_ENV === "development" ? error.message : undefined,
          });
        } else {
          res.write(
            `data: ${JSON.stringify({ error: "Stream interrupted. Please try again.", requestId })}\n\n`
          );
          res.end();
        }
      }
    });
  }
);

/**
 * HealThee AI endpoint
 * POST /healtheeLLM
 * Body: { prompt, system, provider, model, isJson, base64Image }
 */
exports.healtheeLLM = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 120,
    secrets: ["CEREBRAS_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "HF_TOKEN"],
  },
  (req, res) => {
    corsHandler(req, res, async () => {
      // Handle preflight
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      try {
        const { prompt, system, provider, model, isJson, base64Image, max_tokens } = req.body;

        if (!prompt) {
          res.status(400).json({ error: "prompt is required" });
          return;
        }

        const messages = [];
        if (system) messages.push({ role: 'system', content: system });

        if (base64Image) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: base64Image } }
            ]
          });
        } else {
          messages.push({ role: 'user', content: prompt });
        }

        const bodyOptions = {
          model: model || (provider === 'cerebras' ? 'llama3.1-8b' : 'llama-3.3-70b-versatile'),
          messages: messages,
          temperature: 0.1,
          ...(max_tokens && { max_tokens }),
        };

        if (isJson) {
          bodyOptions.response_format = { type: 'json_object' };
        }

        let completion;
        // Dynamically instantiate with API key from environment
        if (provider === 'cerebras') {
          const cerebrasClient = new OpenAI({
            baseURL: "https://api.cerebras.ai/v1",
            apiKey: process.env.CEREBRAS_API_KEY || "",
          });
          completion = await cerebrasClient.chat.completions.create(bodyOptions);
        } else if (provider === 'groq') {
          const groqClient = new OpenAI({
            baseURL: "https://api.groq.com/openai/v1",
            apiKey: process.env.GROQ_API_KEY || "",
          });
          completion = await groqClient.chat.completions.create(bodyOptions);
        } else if (provider === 'openrouter') {
          const orClient = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY || "",
            defaultHeaders: { "HTTP-Referer": "https://navajitd.github.io" },
          });
          // OpenRouter free models don't support response_format — strip it
          const orOptions = { ...bodyOptions };
          delete orOptions.response_format;
          completion = await orClient.chat.completions.create(orOptions);
        } else if (provider === 'huggingface') {
          const hfToken = process.env.HF_TOKEN || "";
          if (!hfToken) {
            res.status(500).json({ error: "HuggingFace token not configured" });
            return;
          }
          // HF Inference API uses a Llama-style prompt for Airavata
          const formattedPrompt = system
            ? `<s>[INST] <<SYS>>\n${system}\n<</SYS>>\n\n${prompt} [/INST]`
            : `<s>[INST] ${prompt} [/INST]`;
          const hfRes = await fetch(
            `https://api-inference.huggingface.co/models/${model || "ai4bharat/Airavata"}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${hfToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                inputs: formattedPrompt,
                parameters: {
                  max_new_tokens: max_tokens || 512,
                  temperature: 0.1,
                  return_full_text: false,
                },
              }),
            }
          );
          if (!hfRes.ok) {
            const errData = await hfRes.json().catch(() => ({}));
            throw new Error(errData.error || `HuggingFace API error: ${hfRes.status}`);
          }
          const hfData = await hfRes.json();
          const hfContent = Array.isArray(hfData)
            ? (hfData[0]?.generated_text || "")
            : (hfData.generated_text || "");
          res.json({ content: hfContent.trim() });
          return;
        } else {
          res.status(400).json({ error: "Invalid provider" });
          return;
        }

        const content = completion.choices[0].message.content;
        res.json({ content });

      } catch (error) {
        console.error("HealThee LLM error:", error);
        res.status(500).json({ error: error.message || "Failed to fetch LLM" });
      }
    });
  }
);
