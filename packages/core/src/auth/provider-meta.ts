/**
 * provider-meta.ts — auth metadata for each provider.
 * Drives the web setup UI (and CLI): which providers are file-based vs api-key,
 * which CLI file to scan, which credential key(s) api-key adapters read.
 */
export type AuthKind = "oauth-file" | "api-key";

export interface CredentialField {
  /** key stored in ProviderConfig.credentials */
  key: string;
  /** input label shown in setup UIs */
  label: string;
  /** short hint on where to find the value */
  hint?: string;
}

export interface ProviderAuthMeta {
  slug: string;
  displayName: string;
  authKind: AuthKind;
  /** for oauth-file: which CLI credential file holds the tokens */
  cliSource?: "claude-cli" | "codex-cli" | "antigravity-cli" | "grok-cli";
  /** for oauth-file: how the user creates that file if it's missing */
  cliLoginHint?: string;
  /** for api-key: the credential fields the adapter reads (1..n) */
  fields?: CredentialField[];
  /** for api-key: a var in ~/.shell_env the setup UI can one-click import */
  envVar?: string;
  /** false = credential reuse not yet wired; setup UI hides it */
  available?: boolean;
}

export const PROVIDER_AUTH_META: ProviderAuthMeta[] = [
  {
    slug: "claude",
    displayName: "Claude Code",
    authKind: "oauth-file",
    cliSource: "claude-cli",
    cliLoginHint: "登录一次官方 CLI：`claude` → /login",
  },
  {
    slug: "codex",
    displayName: "OpenAI Codex",
    authKind: "oauth-file",
    cliSource: "codex-cli",
    cliLoginHint: "登录一次官方 CLI：`codex login`",
  },
  {
    slug: "glm-cn",
    displayName: "智谱清言 GLM",
    authKind: "api-key",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        hint: "bigmodel.cn → 个人中心 → API Keys（Coding Plan 那把）",
      },
    ],
  },
  {
    // Native dashboard scraper — needs the opencode.ai browser session cookie,
    // NOT OpenCode CLI 的 auth.json api key（那是模型代理的，不同认证域）。
    slug: "opencode-go",
    displayName: "OpenCode Go",
    authKind: "api-key",
    fields: [
      {
        key: "workspaceId",
        label: "Workspace ID",
        hint: "opencode.ai dashboard URL 里的 wrk_… 段",
      },
      {
        key: "authCookie",
        label: "Auth Cookie",
        hint: "登录 opencode.ai → DevTools → Cookies → `auth` 的值（Fe26.2** 开头）",
      },
    ],
  },
  {
    slug: "kimi",
    displayName: "Kimi",
    authKind: "api-key",
    fields: [
      { key: "apiKey", label: "API Key", hint: "Kimi Code 计划的 API key" },
    ],
  },
  {
    // Native Google Cloud Code client; reuses the community CLI's token store.
    slug: "antigravity",
    displayName: "Antigravity",
    authKind: "oauth-file",
    cliSource: "antigravity-cli",
    cliLoginHint: "装一次社区 CLI 并登录：`npm i -g antigravity-usage && antigravity-usage login`",
  },
  {
    // xAI OAuth; reuses the token store the grok CLI / cliproxyapi share.
    slug: "grok",
    displayName: "Grok",
    authKind: "oauth-file",
    cliSource: "grok-cli",
    cliLoginHint: "登录一次官方 Grok CLI：`grok login`（或 cliproxyapi 的 xai 登录）",
  },
  {
    slug: "deepseek",
    displayName: "DeepSeek",
    authKind: "api-key",
    envVar: "DEEPSEEK_API_KEY",
    fields: [
      { key: "apiKey", label: "API Key", hint: "platform.deepseek.com → API keys（本机 ~/.shell_env 有 DEEPSEEK_API_KEY 可一键导入）" },
    ],
  },
  {
    slug: "openrouter",
    displayName: "OpenRouter",
    authKind: "api-key",
    envVar: "OPENROUTER_API_KEY",
    fields: [
      { key: "apiKey", label: "API Key", hint: "openrouter.ai → Keys（本机 ~/.shell_env 有 OPENROUTER_API_KEY 可一键导入）" },
    ],
  },
  {
    slug: "aihubmix",
    displayName: "AIHubMix",
    authKind: "api-key",
    fields: [
      { key: "manageKey", label: "系统访问令牌（Manage Key）", hint: "console.aihubmix.com → 设置 → 生成系统访问令牌；sk- 推理 key 不能查余额" },
    ],
  },
  // P2 — not yet wired
  { slug: "copilot", displayName: "GitHub Copilot", authKind: "oauth-file", available: false },
];

export function getProviderAuthMeta(slug: string): ProviderAuthMeta | undefined {
  return PROVIDER_AUTH_META.find((p) => p.slug === slug);
}
