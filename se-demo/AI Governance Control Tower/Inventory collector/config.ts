export const MODEL = process.env.GOVERNANCE_MODEL ?? "claude-sonnet-4-5";

export const SOURCES = [
  {
    id: "3b",
    label: "3B / Tines builds",
    endpoint: "https://api.tines.com/api/v1/stories",
    mode: "mock" as const,
  },
  {
    id: "claude-code",
    label: "Claude Code commits",
    endpoint: "https://api.github.com/search/commits?q=author-email:claude",
    mode: "mock" as const,
  },
  {
    id: "replit",
    label: "Replit projects",
    endpoint: "https://replit.com/graphql",
    mode: "mock" as const,
  },
  {
    id: "github-security",
    label: "GitHub security suite findings",
    endpoint: "https://api.github.com/orgs/realchemistry/code-scanning/alerts",
    mode: "mock" as const,
  },
];

export const TEAMS = [
  "Medical Affairs",
  "Social Strategy",
  "Data & Analytics",
  "Creative",
  "Market Access",
  "Client Services",
  "Regulatory & Compliance",
  "IT & Security",
  "Media Investment",
  "People & Talent",
];
