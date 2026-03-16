# Macro Estimation Improvement — Implementation Plan

## Overview

The feature splits into two distinct pipelines:

1. **Label OCR** — food with a nutrition label → extract exact values → scale to actual portion
2. **Meal Analysis** — photo of a cooked meal or dish → LLM vision → estimated macros

---

## Pipeline 1: Nutrition Label OCR + Portion Scaling

### Goal
When the user photographs a nutrition label (e.g. a protein bar, packaged food, supplement), OCR the exact macro values from the label and then scale them based on the user's stated portion (e.g. "250 ml", "2 scoops", "40g").

---

### Approach A: iOS Native Vision Framework (Recommended for PWA/iOS)
**How it works:**
- iOS 16+ exposes Live Text / VisionKit natively in Safari via the browser's `<input type="file" capture>` — when the user captures a photo, iOS processes the image through its on-device Vision framework before it reaches the app.
- As a PWA, you can trigger "Live Text" by using `<input type="file" accept="image/*">` without `capture` — on iOS, the "Scan Text" option appears in the Photos picker.
- The app then receives a plain image. You still need to run OCR on it.

**OCR in-browser:**
- Use [Tesseract.js](https://tesseract.projectnaptha.com/) (WASM, runs 100% on-device, free/open-source)
- Or send the image to a backend and use iOS's `VNRecognizeTextRequest` via a lightweight Swift/Node proxy

**Pros:**
- 100% free; Tesseract.js runs on-device, no API key needed
- Preserves exact label values (grams, not estimates)
- Privacy-friendly (no image leaves the device with Tesseract.js)

**Cons:**
- Tesseract.js bundle is ~4MB (lazy-load on demand)
- OCR accuracy degrades with curved/glossy labels, angled shots
- Requires robust post-processing regex to parse "Protein 28g", "Calories 350" etc.
- Portion scaling requires the user to also state a quantity ("I'm having 250ml")

**Accuracy enhancement:**
- Pre-process image with canvas: increase contrast, sharpen edges (using CSS filters or a small canvas transform before passing to Tesseract)
- Use `PSM.SINGLE_COLUMN` or `PSM.SPARSE_TEXT` mode for label layouts

---

### Approach B: Cloud Vision OCR (Google Cloud Vision / AWS Textract)
**How it works:**
- Send the image (base64) to a backend endpoint
- Google Cloud Vision `TEXT_DETECTION` or AWS Textract `DetectDocumentText` returns structured text
- Parse with regex for macro fields

**Pros:**
- Much higher accuracy than Tesseract.js (handles glossy labels, varied fonts)
- Google Cloud Vision: first 1,000 units/month free

**Cons:**
- Requires a backend cloud function (already have Firebase Functions)
- Image leaves device (privacy trade-off)
- Cost at scale (>1k requests/month with Google, or AWS Textract charges)
- Still needs robust parsing logic post-OCR

---

### Approach C: LLM-as-OCR (Current + Fallback)
**How it works:**
- Send image to a vision-capable LLM (Groq `llama-3.2-11b-vision-preview` or similar)
- Prompt: "If this is a nutrition label, extract the exact macro values. Return JSON."

**Pros:**
- Already implemented as the current fallback
- Handles labels AND meals in one pass
- No additional dependencies

**Cons:**
- LLM is less reliable than dedicated OCR for structured data
- Groq vision model has rate limits
- Can hallucinate values on blurry/partial labels

---

### Portion Scaling Logic (all approaches)
After extracting per-100g or per-serving values:

```
servingSize = extractedLabel.servingSize (e.g. "30g" or "100ml")
userPortion = user input (e.g. "250ml" or "40g")
scaleFactor = userPortion / servingSize
scaledMacros = { cal: label.cal * scaleFactor, protein: ..., ... }
```

The user input for portion should be a free-text field that gets parsed with:
- A simple regex for `\d+(\.\d+)?\s*(g|ml|oz|tbsp|tsp|cups?|scoops?)`
- Or a short LLM call: "User says '2 scoops'. Label serving is 30g. How many grams?" → pure text, cheap

---

### Recommended Implementation (Label OCR)

**Phase 1 (Fastest, uses existing backend):**
- Add a UI toggle in the custom food modal: "📷 Label" vs "🍽 Meal"
- For Label mode: send image to existing Groq vision endpoint with a stricter prompt focused on OCR
- Add a "Portion" input field for the user to specify quantity
- Scale extracted values before saving

**Phase 2 (Better accuracy):**
- Lazy-load Tesseract.js (4MB WASM) on demand
- Run on-device OCR for labels → parse with regex
- Fall back to LLM vision if Tesseract confidence < 70%

---

## Pipeline 2: Meal Photo Analysis (LLM Vision)

### Goal
When the user photographs a home-cooked meal, restaurant plate, or thali, estimate macros using an LLM that understands food.

### Current State
Already implemented: Groq `llama-3.2-11b-vision-preview` (11B parameter vision model).

### Improvement Approaches

---

### Approach A: Better Prompting of Existing Model
**Changes:**
- Break the prompt into two LLM calls:
  1. "Identify all food items visible in this image and estimate their weights in grams." (JSON list)
  2. "For each item in this list, estimate macros per 100g." (JSON object)
- Then compute total from per-item macros × weight
- More accurate than asking for total macros in one shot

**Pros:** Free, uses existing infrastructure, quick to implement
**Cons:** Doubles LLM calls (2× latency), still limited by model capability

---

### Approach B: Groq `llama-3.2-90b-vision-preview` (Larger Vision Model)
**How it works:**
- Same API, larger model, better accuracy on complex scenes (multi-dish thalis, layered dishes)
- Currently free on Groq with generous rate limits

**Pros:** Significant accuracy improvement vs 11B, same API
**Cons:** Higher latency (~3-5s vs ~1-2s), may have lower rate limits

---

### Approach C: GPT-4o Vision or Claude claude-sonnet-4-6 (Best Accuracy)
**How it works:**
- Route meal-photo requests to OpenAI GPT-4o or Anthropic Claude via the existing cloud function proxy

**Pros:** Best-in-class accuracy for food identification
**Cons:** Cost (~$0.002–0.01 per image), requires API key in cloud function

---

### Approach D: Open-Source Food-Specific Vision Models
Several models fine-tuned specifically on food datasets:

| Model | Source | Notes |
|-------|--------|-------|
| `Qwen2.5-VL-7B` | HuggingFace | Strong food recognition, runs on GPU server |
| `InternVL2-8B` | HuggingFace | Competitive with GPT-4V on food tasks |
| `LLaVA-1.6-Mistral-7B` | HuggingFace | Good general vision, food prompt tuning needed |

**Deployment options:**
- [Hugging Face Inference Endpoints](https://huggingface.co/inference-endpoints) (free tier exists)
- [Replicate](https://replicate.com/) (pay-per-call, very cheap for 7B models)
- Self-host on a $5/month GPU VM (Vast.ai, RunPod)

**Pros:** No per-call cost at self-host; food-domain fine-tuning possible
**Cons:** Requires infrastructure; latency 3-10s; models not specifically trained on Indian cuisine

---

### Approach E: Nutritionix / OpenFoodFacts API Hybrid
**How it works:**
1. LLM vision identifies food items ("dal makhani, 2 chapatis, salad")
2. Query OpenFoodFacts or Nutritionix API for each identified item
3. Sum macros based on estimated portion weights

**Pros:** Nutritionix has Indian foods database; more accurate per-item macros
**Cons:** OpenFoodFacts Indian food coverage is poor; Nutritionix API has daily limits on free tier; two-step adds latency

---

## Pipeline 3: Macro Estimation Improvement (Text-Only, No Image)

The current text-based estimation (name + description → LLM → macros) can be improved:

### Approach A: Retrieval-Augmented Generation with OpenFoodFacts
- Before calling the LLM, query OpenFoodFacts (`world.openfoodfacts.org/cgi/search.pl?search_terms=...&json=1`) for the food name
- If a match is found with confidence >80%, use those values directly
- Only call LLM for unmatched items

**Pros:** Exact values for packaged foods; free and open-source
**Cons:** Poor coverage for home-cooked Indian meals; adds 200-500ms network round-trip

### Approach B: Local Indian Nutrition Database
- Embed the [NIN India food composition table](https://www.nin.res.in/) as a JSON lookup
- ~9,000 Indian food items with exact values
- Fuzzy string match on food name → return closest match macros

**Pros:** 100% free, offline, perfect for Indian foods
**Cons:** ~2MB JSON payload; fuzzy matching logic adds complexity; doesn't handle custom dishes

### Approach C: Two-Stage LLM with Validation
- Stage 1 (fast, cheap): Quick LLM estimate with `llama-3.1-8b` or similar small model
- Stage 2 (validation): Second call asks "Does this seem right for [food]? Adjust if wrong."
- Use the validated result

**Pros:** Catches obvious errors (e.g. zero carbs for rice)
**Cons:** 2× latency and cost

---

## Recommended Roadmap

### Sprint 1 (1-2 days): Quick wins
1. Add "Label" mode toggle in food modal (separate from meal photo)
2. Improve Groq vision prompt for labels: stricter JSON schema, focus on OCR extraction
3. Add portion size input field + scaling logic
4. Switch meal analysis to `llama-3.2-90b-vision-preview` for better accuracy

### Sprint 2 (3-5 days): Label OCR pipeline
1. Lazy-load Tesseract.js for on-device label OCR
2. Build regex parser for common nutrition label formats
3. Confidence threshold: if Tesseract < 70% confident → fall back to LLM vision
4. Implement portion scaling (regex + optional LLM for ambiguous units)

### Sprint 3 (1 week): Food database integration
1. Integrate OpenFoodFacts API for packaged foods
2. Embed NIN India database JSON for Indian food lookup
3. Build fallback chain: database → LLM estimate

### Sprint 4 (future): Fine-tuned model
1. Collect correction data (user edits to AI-estimated macros)
2. Fine-tune a small vision model on Indian food images using LoRA
3. Host on Replicate or Hugging Face

---

## Decision Matrix

| Approach | Accuracy | Cost | Latency | Complexity | Recommended? |
|----------|----------|------|---------|------------|--------------|
| LLM vision (current) | ★★☆ | Free | 2s | Low | ✓ Baseline |
| Better LLM prompt | ★★★ | Free | 3s | Low | ✓ Do first |
| 90B vision model | ★★★ | Free | 4s | Low | ✓ Do first |
| Tesseract.js OCR | ★★★ (labels) | Free | 2s | Medium | ✓ Labels |
| Cloud Vision OCR | ★★★★ | ~Free | 1s | Medium | Later |
| OpenFoodFacts | ★★★★ (packaged) | Free | 0.3s | Medium | ✓ Sprint 3 |
| NIN India DB | ★★★★ (Indian) | Free | <0.1s | Medium | ✓ Sprint 3 |
| GPT-4o / Claude | ★★★★★ | ~$0.005/call | 3s | Low | Premium tier |
| Self-hosted 7B | ★★★ | Fixed infra | 5s | High | Later |
