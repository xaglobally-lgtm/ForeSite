import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const EVENT_TYPES = [
  "SCOPE_CHANGE", "EXTRA_WORK", "UNPRICED_WORK", "WORK_STARTED_WITHOUT_APPROVAL",
  "MATERIAL_DELAY", "MATERIAL_SHORTAGE", "MATERIAL_DAMAGE", "MATERIAL_WRONG",
  "CREW_DELAY", "CREW_IDLE", "CREW_UNAVAILABLE", "TRADE_DELAY",
  "DEPENDENCY_BLOCKED",
  "REWORK", "DEFECT", "INSPECTION_FAILURE",
  "CUSTOMER_REQUEST", "CUSTOMER_COMPLAINT", "CUSTOMER_APPROVAL_REQUIRED",
  "SCHEDULE_RISK", "MILESTONE_RISK", "COMPLETION_RISK",
  "DOCUMENTATION_GAP", "APPROVAL_MISSING",
  "RECURRING_PROBLEM",
] as const;

export interface ExtractedEvent {
  type: (typeof EVENT_TYPES)[number];
  title: string;
  description: string;
  confidence: number;
  fact: string | null;
  signal: string | null;
  inference: string | null;
  recommendation: string | null;
  entities: string[];
  financial_signals: {
    affected_hours: number | null;
    material_quantity: number | null;
    material_unit: string | null;
    known_unit_cost: number | null;
    stated_dollar_amount: number | null;
  };
  risk_factors: { probability: number; impact: number; urgency: number };
}

const SYSTEM_PROMPT = `You are the extraction engine inside a construction jobsite-intelligence system.
Read the field input and extract ONLY meaningful business events using this fixed taxonomy:
${EVENT_TYPES.join(", ")}.

Rules:
- Output ONLY valid JSON matching the schema you're given. No prose, no markdown fences.
- If nothing meaningful is present, return {"events":[]}.
- Never invent dollar amounts, dates, quantities, or approvals that are not stated or clearly implied.
- Be conservative on photos: never assert structural, safety, or legal conclusions — use
  "possible X, review recommended" language.
- Do not assign blame to a specific subcontractor unless the input explicitly names a repeated
  pattern; use neutral language like "recurring issue pattern detected".
- A vague or distant hypothetical should get low confidence and low urgency, not be treated as
  an active event.`;

type InputPayload =
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType: string; base64: string; caption?: string }
  | { kind: "pdf"; base64: string };

export async function extractEvents(input: InputPayload): Promise<ExtractedEvent[]> {
  const content: Anthropic.MessageParam["content"] = [];

  if (input.kind === "image") {
    content.push({ type: "image", source: { type: "base64", media_type: input.mediaType as any, data: input.base64 } });
    content.push({ type: "text", text: `Field photo. ${input.caption ? "Caption: " + input.caption : ""}` });
  } else if (input.kind === "pdf") {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.base64 } });
    content.push({ type: "text", text: "Document submitted from the jobsite. Extract any meaningful events." });
  } else {
    content.push({ type: "text", text: input.text });
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  return parseEvents(text);
}

function parseEvents(raw: string): ExtractedEvent[] {
  const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed.events) ? parsed.events : [];
    } catch {
      return [];
    }
  }
}

/** Ask My Jobs — grounded Q&A. Retrieval happens in the caller (a real DB query);
 *  this only ever sees the evidence array it's handed, and is told to answer
 *  from that alone (spec §45 — never let the LLM just guess). */
export async function answerFromEvidence(question: string, evidence: unknown[]): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: `You are "Ask My Jobs". Answer ONLY using the JSON evidence array in the user message —
never invent projects, numbers, or events not present in it. If the evidence doesn't answer the
question, say so plainly. Reference alerts by project name and title, not ids. Be concise.`,
    messages: [{ role: "user", content: `QUESTION: ${question}\n\nEVIDENCE:\n${JSON.stringify(evidence)}` }],
  });
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}
