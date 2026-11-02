export const ENRICHMENT_MODEL = process.env.SHADOW_ENRICHMENT_MODEL ?? "gemini-2.5-pro";

/**
 * Telemetry sources. Labels stay vendor-generic on purpose: "Microsoft Defender" for the
 * endpoint feed and "EDR / SIEM" for the aggregated log feed. Swap `observations()` for
 * a real query (Defender advanced hunting / SIEM search) and keep the record shape.
 */
export const FEEDS = [
  {
    id: "defender",
    label: "Microsoft Defender",
    query: "DeviceNetworkEvents | where RemoteUrl has_any (aiDomains)",
    endpoint: "https://api.security.microsoft.com/api/advancedhunting/run",
  },
  {
    id: "edr-siem",
    label: "EDR / SIEM",
    query: "index=proxy category=\"AI/ML\" | stats dc(user) by domain",
    endpoint: "https://siem.internal.realchemistry.com/services/search/jobs",
  },
];

export type Observation = {
  domain: string;
  tool: string;
  feed: string;
  users: number;
  devices: number;
  sessions_7d: number;
  first_seen_days_ago: number;
  uploads_detected: boolean;
  top_teams: string[];
};

export const OBSERVATIONS: Observation[] = [
  { domain: "claude.ai", tool: "Claude", feed: "Microsoft Defender", users: 612, devices: 690, sessions_7d: 9120, first_seen_days_ago: 420, uploads_detected: true, top_teams: ["Data & Analytics", "Creative"] },
  { domain: "chatgpt.com", tool: "ChatGPT Enterprise", feed: "Microsoft Defender", users: 1480, devices: 1602, sessions_7d: 21400, first_seen_days_ago: 610, uploads_detected: true, top_teams: ["Creative", "Client Services"] },
  { domain: "gemini.google.com", tool: "Google Gemini", feed: "EDR / SIEM", users: 340, devices: 372, sessions_7d: 4100, first_seen_days_ago: 300, uploads_detected: false, top_teams: ["Media Investment"] },
  { domain: "copilot.microsoft.com", tool: "Microsoft Copilot", feed: "Microsoft Defender", users: 1720, devices: 1810, sessions_7d: 26800, first_seen_days_ago: 500, uploads_detected: false, top_teams: ["People & Talent", "Client Services"] },
  { domain: "github.com/copilot", tool: "GitHub Copilot", feed: "EDR / SIEM", users: 210, devices: 224, sessions_7d: 3900, first_seen_days_ago: 480, uploads_detected: false, top_teams: ["Data & Analytics"] },
  { domain: "replit.com", tool: "Replit", feed: "EDR / SIEM", users: 96, devices: 104, sessions_7d: 1180, first_seen_days_ago: 260, uploads_detected: true, top_teams: ["Creative", "Medical Affairs"] },
  { domain: "perplexity.ai", tool: "Perplexity", feed: "Microsoft Defender", users: 288, devices: 301, sessions_7d: 2600, first_seen_days_ago: 180, uploads_detected: false, top_teams: ["Market Access"] },
  { domain: "notion.so/ai", tool: "Notion AI", feed: "EDR / SIEM", users: 174, devices: 190, sessions_7d: 1450, first_seen_days_ago: 220, uploads_detected: false, top_teams: ["Social Strategy"] },
  { domain: "character.ai", tool: "Character.AI", feed: "Microsoft Defender", users: 22, devices: 24, sessions_7d: 140, first_seen_days_ago: 150, uploads_detected: false, top_teams: ["People & Talent"] },
  { domain: "api.deepseek.com", tool: "DeepSeek API", feed: "EDR / SIEM", users: 4, devices: 5, sessions_7d: 880, first_seen_days_ago: 5, uploads_detected: true, top_teams: ["Medical Affairs"] },
  { domain: "lovable.dev", tool: "Lovable", feed: "Microsoft Defender", users: 17, devices: 19, sessions_7d: 240, first_seen_days_ago: 4, uploads_detected: true, top_teams: ["Creative", "Social Strategy"] },
  { domain: "heygen.com", tool: "HeyGen", feed: "EDR / SIEM", users: 11, devices: 12, sessions_7d: 96, first_seen_days_ago: 6, uploads_detected: true, top_teams: ["Creative"] },
  { domain: "otter.ai", tool: "Otter.ai", feed: "Microsoft Defender", users: 63, devices: 71, sessions_7d: 410, first_seen_days_ago: 3, uploads_detected: true, top_teams: ["Medical Affairs", "Client Services"] },
  { domain: "chat.qwen.ai", tool: "Qwen Chat", feed: "EDR / SIEM", users: 6, devices: 6, sessions_7d: 52, first_seen_days_ago: 2, uploads_detected: false, top_teams: ["Data & Analytics"] },
  { domain: "app.hume.ai", tool: "Hume AI", feed: "Microsoft Defender", users: 3, devices: 3, sessions_7d: 28, first_seen_days_ago: 6, uploads_detected: false, top_teams: ["Social Strategy"] },
];

/** Enrichment catalog — the swap point for a vendor-risk API or a model call. */
export const CATALOG: Record<string, { vendor: string; category: string; hq: string; risk_notes: string; trains_on_input: boolean; baa: boolean }> = {
  "claude.ai": { vendor: "Anthropic", category: "General assistant", hq: "United States", risk_notes: "Enterprise agreement in place; zero-retention configured.", trains_on_input: false, baa: true },
  "chatgpt.com": { vendor: "OpenAI", category: "General assistant", hq: "United States", risk_notes: "Enterprise tenant with SSO and retention controls.", trains_on_input: false, baa: true },
  "gemini.google.com": { vendor: "Google", category: "General assistant", hq: "United States", risk_notes: "Covered under existing Workspace terms.", trains_on_input: false, baa: true },
  "copilot.microsoft.com": { vendor: "Microsoft", category: "General assistant", hq: "United States", risk_notes: "Entra-bound, data stays in tenant boundary.", trains_on_input: false, baa: true },
  "github.com/copilot": { vendor: "GitHub", category: "Code assistant", hq: "United States", risk_notes: "Org-managed; code suggestions logged.", trains_on_input: false, baa: false },
  "replit.com": { vendor: "Replit", category: "AI app builder", hq: "United States", risk_notes: "Approved for internal-only prototypes; no PHI clause.", trains_on_input: false, baa: false },
  "perplexity.ai": { vendor: "Perplexity", category: "Research assistant", hq: "United States", risk_notes: "Approved for public-data research only.", trains_on_input: true, baa: false },
  "notion.so/ai": { vendor: "Notion", category: "Productivity AI", hq: "United States", risk_notes: "Workspace-scoped; DPA signed.", trains_on_input: false, baa: false },
  "character.ai": { vendor: "Character Technologies", category: "Consumer chatbot", hq: "United States", risk_notes: "Consumer service, no business purpose; blocked.", trains_on_input: true, baa: false },
  "api.deepseek.com": { vendor: "DeepSeek", category: "Model API", hq: "China", risk_notes: "Inference hosted outside approved regions; prompts retained; no DPA or BAA. PHI observed in payloads.", trains_on_input: true, baa: false },
  "lovable.dev": { vendor: "Lovable", category: "AI app builder", hq: "Sweden", risk_notes: "Generates and hosts apps outside SDLC; secrets frequently pasted into project settings.", trains_on_input: false, baa: false },
  "heygen.com": { vendor: "HeyGen", category: "Synthetic video / avatars", hq: "United States", risk_notes: "Likeness and voice cloning; consent and MLR review required for any HCP-facing asset.", trains_on_input: true, baa: false },
  "otter.ai": { vendor: "Otter.ai", category: "Meeting transcription", hq: "United States", risk_notes: "Joins calls and retains transcripts; high risk of capturing patient and client discussion. No BAA.", trains_on_input: true, baa: false },
  "chat.qwen.ai": { vendor: "Alibaba Cloud", category: "General assistant", hq: "China", risk_notes: "Consumer tier, prompts retained for training; outside approved regions.", trains_on_input: true, baa: false },
  "app.hume.ai": { vendor: "Hume AI", category: "Emotion / voice AI", hq: "United States", risk_notes: "Processes voice biometrics; state biometric-privacy exposure.", trains_on_input: false, baa: false },
};

/** Seeded on first run so the change history has depth; afterwards the volume is the source of truth. */
export const BASELINE: Array<{ domain: string; decision: "allow" | "block"; days_ago: number; actor: string; note: string }> = [
  { domain: "chatgpt.com", decision: "allow", days_ago: 300, actor: "AI Board", note: "Enterprise agreement executed." },
  { domain: "copilot.microsoft.com", decision: "allow", days_ago: 280, actor: "AI Board", note: "In-tenant, Entra bound." },
  { domain: "claude.ai", decision: "allow", days_ago: 240, actor: "AI Board", note: "Zero-retention enterprise plan." },
  { domain: "github.com/copilot", decision: "allow", days_ago: 210, actor: "Security / IT review", note: "Org-managed seats only." },
  { domain: "gemini.google.com", decision: "allow", days_ago: 160, actor: "AI Working Group", note: "Covered by Workspace DPA." },
  { domain: "notion.so/ai", decision: "allow", days_ago: 120, actor: "AI Working Group", note: "Workspace-scoped." },
  { domain: "replit.com", decision: "allow", days_ago: 96, actor: "AI Board", note: "Internal-only prototypes; no PHI." },
  { domain: "perplexity.ai", decision: "allow", days_ago: 74, actor: "AI Working Group", note: "Public-data research only." },
  { domain: "character.ai", decision: "block", days_ago: 58, actor: "Security / IT review", note: "Consumer chatbot, no business purpose." },
  { domain: "poe.com", decision: "block", days_ago: 44, actor: "Security / IT review", note: "Model proxy bypasses tenant controls." },
  { domain: "janitorai.com", decision: "block", days_ago: 31, actor: "Security / IT review", note: "Consumer service; blocked at proxy." },
];
