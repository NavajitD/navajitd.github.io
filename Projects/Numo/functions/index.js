const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const OpenAI = require("openai");
const cors = require("cors");
const { SYSTEM_PROMPT } = require("./systemPrompt");

admin.initializeApp();
const db = admin.firestore();

// CORS middleware
const corsHandler = cors({ origin: true });

// Initialize Cerebras client (OpenAI-compatible)
const cerebras = new OpenAI({
  baseURL: "https://api.cerebras.ai/v1",
  apiKey: process.env.CEREBRAS_API_KEY || "",
});

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
    secrets: ["CEREBRAS_API_KEY"],
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
        const { message, sessionId, userDob, userName, userGender } = req.body;

        if (!message || !sessionId) {
          res.status(400).json({ error: "message and sessionId are required" });
          return;
        }

        // Get or create session
        const sessionRef = db.collection("numo_sessions").doc(sessionId);
        const sessionDoc = await sessionRef.get();

        if (!sessionDoc.exists && userDob) {
          // Create new session with user profile
          await sessionRef.set({
            userName: userName || "Friend",
            userDob: userDob,
            userGender: userGender || "unknown",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        // Load last 10 messages for context
        const messagesSnap = await sessionRef
          .collection("messages")
          .orderBy("timestamp", "desc")
          .limit(10)
          .get();

        const history = [];
        messagesSnap.docs.reverse().forEach((doc) => {
          const data = doc.data();
          history.push({ role: data.role, content: data.content });
        });

        // Build context with user info
        let userContext = "";
        if (userDob) {
          userContext = `\n\nCURRENT USER INFO:\nName: ${userName || "Not provided"}\nDate of Birth: ${userDob}\nGender: ${userGender || "Not specified"}\n\nCalculate their Pilot, Co-Pilot, and Flight Attendant numbers from this DOB and use them in all readings.`;
        }

        // Build messages array for Cerebras
        const messages = [
          { role: "system", content: SYSTEM_PROMPT + userContext },
          ...history,
          { role: "user", content: message },
        ];

        // Set up SSE streaming
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // Call Cerebras API with streaming
        const stream = await cerebras.chat.completions.create({
          model: "llama3.1-8b",
          messages: messages,
          temperature: 0.7,
          max_tokens: 2048,
          stream: true,
        });

        let fullResponse = "";

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullResponse += content;
            // Send SSE event
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }

        // Send done event
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

        // Save messages to Firestore (fire and forget)
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
      } catch (error) {
        console.error("Numo chat error:", error);

        // If headers haven't been sent yet, send error as JSON
        if (!res.headersSent) {
          res.status(500).json({
            error: "Something went wrong. Please try again.",
            details:
              process.env.NODE_ENV === "development" ? error.message : undefined,
          });
        } else {
          // If streaming was in progress, send error as SSE
          res.write(
            `data: ${JSON.stringify({ error: "Stream interrupted. Please try again." })}\n\n`
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
    secrets: ["CEREBRAS_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"],
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
