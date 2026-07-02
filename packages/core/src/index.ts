// @quota-watch/core - entry point
export * from './types.js';
export * from './windows.js';
export * from './providers/index.js';
export { codexProvider } from './providers/codex.js';
export { QuotaDB, type LatestSnapshot } from './db.js';
export { QuotaScheduler } from './scheduler.js';
export type { SchedulerConfig } from './scheduler.js';
export { AlertEngine } from './alerter.js';
export type { AlertNotifier, AlertMessage } from './alerter.js';
export { DiscordNotifier, buildDiscordPayload } from './notifiers/discord.js';
export { predictConsumption } from './predictor.js';
export {
  loadAppConfig,
  saveAppConfig,
  ensureApiToken,
  isLoopbackHost,
  defaultConfigPath,
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type PollConfig,
  type ApiConfig,
} from './config.js';
export {
  startApiServer,
  buildQuotaResponse,
  type ApiServerOptions,
  type QuotaApiProvider,
} from './api-server.js';
export {
  resolveCliTokens,
  readClaudeCliCredentials,
  readCodexCliCredentials,
  readAntigravityCliCredentials,
  antigravityTokensPath,
  type ResolvedTokens,
  type TokenSource,
} from './auth/credential-source.js';
export { resolveCredentials, fetchWithRefresh, type QuotaFetcher } from './auth/token-manager.js';
export { refreshAndPersist, type RefreshedTokens } from './auth/refresh.js';
export {
  PROVIDER_AUTH_META,
  getProviderAuthMeta,
  type ProviderAuthMeta,
  type AuthKind,
  type CredentialField,
} from './auth/provider-meta.js';
