type AgentFlavorDef = {
  agentKind: "claude-code" | "opencode" | "cursor" | "windsurf" | "copilot" | "zed" | "gemini-cli" | "codex-cli" | "antigravity-cli" | "web" | "unknown";
  name: string;
  docsUrl: string;

  bin?: string;
  fallbackBins?: string[];
  versionArgs?: string[];

  install:
    | { kind: "cli"; command: string[] }
    | { kind: "json"; configPath: string; shape: "mcpServers" | "contextServers" }
    | { kind: "manual"; format: "json" | "yaml" | "toml"; configPath: string | null };

  transport: "http" | "stdio-proxy";

  liveTier: "plugin" | "polling" | "none";

  rules?: { path: string; format: "mdc" | "md" | "agents-md" };

  verifiedAt: string | null;
  verifiedVersion: string | null;
};

const AGENT_FLAVORS = {
  "claude-code": {
    agentKind: "claude-code",
    name: "Claude Code",
    docsUrl: "docs/roadmap-integrations/03-scope-int-3-claude-code-plugin.md",
    bin: "claude",
    fallbackBins: ["openclaude"],
    versionArgs: ["--version"],
    install: {
      kind: "cli",
      command: ["claude", "mcp", "add", "open-graph", "--transport", "http", "--", "--server", "http://localhost:8787", "--name", "{{NAME}}", "--live", "--agent-kind", "claude-code"],
    },
    transport: "stdio-proxy",
    liveTier: "plugin",
    rules: { path: "CLAUDE.md", format: "md" },
    verifiedAt: "2026-07-16",
    verifiedVersion: "2.x",
  },
  opencode: {
    agentKind: "opencode",
    name: "opencode",
    docsUrl: "docs/roadmap-integrations/04-scope-int-4-opencode-plugin.md",
    bin: "opencode-cli",
    fallbackBins: ["opencode"],
    versionArgs: ["--version"],
    install: {
      kind: "json",
      configPath: "~/.config/opencode/opencode.json",
      shape: "mcpServers",
    },
    transport: "stdio-proxy",
    liveTier: "plugin",
    rules: { path: "AGENTS.md", format: "agents-md" },
    verifiedAt: "2026-07-16",
    verifiedVersion: null,
  },
  "codex-cli": {
    agentKind: "codex-cli",
    name: "Codex CLI",
    docsUrl: "docs/roadmap-integrations/README.md",
    bin: "codex",
    versionArgs: ["--version"],
    install: {
      kind: "cli",
      command: ["codex", "mcp", "add", "open-graph", "--", "--server", "http://localhost:8787", "--name", "{{NAME}}", "--live", "--agent-kind", "codex-cli"],
    },
    transport: "stdio-proxy",
    liveTier: "plugin",
    rules: { path: "AGENTS.md", format: "agents-md" },
    verifiedAt: null,
    verifiedVersion: null,
  },
  "antigravity-cli": {
    agentKind: "antigravity-cli",
    name: "Antigravity CLI",
    docsUrl: "docs/roadmap-integrations/README.md",
    bin: "agy",
    fallbackBins: ["antigravity"],
    versionArgs: ["--version"],
    install: {
      kind: "json",
      configPath: "~/.agy/settings.json",
      shape: "mcpServers",
    },
    transport: "http",
    liveTier: "polling",
    rules: { path: "AGENTS.md", format: "agents-md" },
    verifiedAt: null,
    verifiedVersion: null,
  },
  cursor: {
    agentKind: "cursor",
    name: "Cursor",
    docsUrl: "docs/roadmap-integrations/05-scope-int-5-editor-agents.md",
    install: {
      kind: "json",
      configPath: ".cursor/mcp.json",
      shape: "mcpServers",
    },
    transport: "stdio-proxy",
    liveTier: "none",
    rules: { path: ".cursor/rules/open-graph.mdc", format: "mdc" },
    verifiedAt: null,
    verifiedVersion: null,
  },
  windsurf: {
    agentKind: "windsurf",
    name: "Windsurf",
    docsUrl: "docs/roadmap-integrations/05-scope-int-5-editor-agents.md",
    install: {
      kind: "json",
      configPath: ".windsurf/mcp_config.json",
      shape: "mcpServers",
    },
    transport: "stdio-proxy",
    liveTier: "none",
    rules: { path: ".windsurf/rules/open-graph.md", format: "md" },
    verifiedAt: null,
    verifiedVersion: null,
  },
  copilot: {
    agentKind: "copilot",
    name: "Copilot",
    docsUrl: "docs/roadmap-integrations/05-scope-int-5-editor-agents.md",
    install: {
      kind: "json",
      configPath: ".github/copilot-instructions.md",
      shape: "contextServers",
    },
    transport: "stdio-proxy",
    liveTier: "none",
    rules: { path: ".github/open-graph.md", format: "md" },
    verifiedAt: null,
    verifiedVersion: null,
  },
  zed: {
    agentKind: "zed",
    name: "Zed",
    docsUrl: "docs/roadmap-integrations/05-scope-int-5-editor-agents.md",
    install: {
      kind: "json",
      configPath: ".zed/mcp.json",
      shape: "contextServers",
    },
    transport: "stdio-proxy",
    liveTier: "none",
    verifiedAt: null,
    verifiedVersion: null,
  },
  "gemini-cli": {
    agentKind: "gemini-cli",
    name: "Gemini CLI",
    docsUrl: "docs/roadmap-integrations/05-scope-int-5-editor-agents.md",
    install: {
      kind: "json",
      configPath: ".gemini/mcp.json",
      shape: "mcpServers",
    },
    transport: "stdio-proxy",
    liveTier: "none",
    rules: { path: "GEMINI.md", format: "md" },
    verifiedAt: null,
    verifiedVersion: null,
  },
  web: {
    agentKind: "web",
    name: "Web",
    docsUrl: "docs/roadmap-integrations/README.md",
    install: {
      kind: "manual",
      format: "json",
      configPath: null,
    },
    transport: "http",
    liveTier: "none",
    verifiedAt: null,
    verifiedVersion: null,
  },
  unknown: {
    agentKind: "unknown",
    name: "Unknown",
    docsUrl: "docs/roadmap-integrations/README.md",
    install: {
      kind: "manual",
      format: "json",
      configPath: null,
    },
    transport: "http",
    liveTier: "none",
    verifiedAt: null,
    verifiedVersion: null,
  },
} as const satisfies Record<string, AgentFlavorDef>;

type AgentKind = keyof typeof AGENT_FLAVORS;

function flavor(agentKind: string): AgentFlavorDef {
  const def = AGENT_FLAVORS[agentKind as AgentKind];
  if (!def) throw new Error(`unknown agentKind: ${agentKind}`);
  return def;
}

function maybeFlavor(agentKind: string): AgentFlavorDef | undefined {
  return AGENT_FLAVORS[agentKind as AgentKind];
}

const ALL_AGENT_KINDS: string[] = Object.keys(AGENT_FLAVORS);

function detectableFlavors(): AgentFlavorDef[] {
  return Object.values(AGENT_FLAVORS).filter((f) => f.bin !== undefined);
}

function liveFlavors(): AgentFlavorDef[] {
  return Object.values(AGENT_FLAVORS).filter((f) => f.liveTier === "plugin" || f.liveTier === "polling");
}

export {
  type AgentFlavorDef,
  type AgentKind,
  AGENT_FLAVORS,
  flavor,
  maybeFlavor,
  ALL_AGENT_KINDS,
  detectableFlavors,
  liveFlavors,
};
