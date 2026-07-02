import type { Command } from 'commander';
import prompts from 'prompts';
import chalk from 'chalk';
import Table from 'cli-table3';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  QuotaDB,
  fetchWithRefresh,
  PROVIDER_AUTH_META,
  claudeProvider,
  codexProvider,
  glmCnProvider,
  opencodeGoProvider,
  kimiProvider,
  antigravityProvider,
} from '@quota-watch/core';
import type { ProviderAdapter, ProviderAuthMeta, ProviderConfig } from '@quota-watch/core';

// ── Provider metadata (single source of truth: PROVIDER_AUTH_META) ───────

const ADAPTER_BY_SLUG: Record<string, ProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
  'glm-cn': glmCnProvider,
  'opencode-go': opencodeGoProvider,
  kimi: kimiProvider,
  antigravity: antigravityProvider,
};

interface ProviderMeta {
  slug: string;
  displayName: string;
  adapter: ProviderAdapter;
  credentialPrompts: Array<{
    name: string;
    message: string;
    type: string;
    initial?: string | ((prev: Record<string, string>) => string);
  }>;
}

/** Pre-fill the codex access token from ~/.codex/auth.json if present. */
function codexTokenInitial(): string {
  const authPath = join(homedir(), '.codex', 'auth.json');
  if (existsSync(authPath)) {
    try {
      const raw = JSON.parse(readFileSync(authPath, 'utf-8')) as { tokens?: { access_token?: string } };
      const t = raw.tokens?.access_token;
      if (typeof t === 'string') return t;
    } catch { /* ignore */ }
  }
  return '';
}

function promptsFor(m: ProviderAuthMeta): ProviderMeta['credentialPrompts'] {
  if (m.authKind === 'api-key') {
    const fields = m.fields ?? [{ key: 'apiKey', label: 'API key' }];
    return fields.map((f) => ({
      name: f.key,
      message: f.hint ? `${f.label} (${f.hint})` : f.label,
      type: 'text',
    }));
  }
  // oauth-file: prompt for token (manual-paste fallback — resolveCredentials
  // pulls the live token from the CLI file at fetch time anyway).
  if (m.slug === 'codex') {
    return [{ name: 'token', message: 'Access token', type: 'text', initial: codexTokenInitial }];
  }
  return [{ name: 'token', message: 'OAuth token (可留空，自动读本机 CLI 凭据)', type: 'text' }];
}

// PROVIDER_AUTH_META is shared with the web /setup UI — one list, no drift.
// Only available providers with a registered adapter are listed here.
const PROVIDERS: ProviderMeta[] = PROVIDER_AUTH_META
  .filter((m) => m.available !== false && ADAPTER_BY_SLUG[m.slug])
  .map((m) => ({
    slug: m.slug,
    displayName: m.displayName,
    adapter: ADAPTER_BY_SLUG[m.slug]!,
    credentialPrompts: promptsFor(m),
  }));

// ── Helper: open DB ──────────────────────────────────────────────────────

function openDB(): QuotaDB {
  const dbDir = join(homedir(), '.quota-watch');
  return new QuotaDB(join(dbDir, 'data.db'));
}

// ── Subcommand: list ─────────────────────────────────────────────────────

async function cmdList(): Promise<void> {
  const db = openDB();
  try {
    const providers = db.listProviders();

    if (providers.length === 0) {
      console.log(chalk.yellow('No providers configured yet.'));
      console.log(chalk.dim('Run: quota-watch config add <provider>'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Provider'),
        chalk.cyan('Display Name'),
        chalk.cyan('Enabled'),
      ],
    });

    for (const p of providers) {
      table.push([
        p.id.slice(0, 8),
        p.provider,
        p.displayName,
        p.enabled ? chalk.green('✓') : chalk.red('✗'),
      ]);
    }

    console.log(table.toString());
  } finally {
    db.close();
  }
}

// ── Subcommand: add ──────────────────────────────────────────────────────

async function cmdAdd(providerSlug: string | undefined): Promise<void> {
  if (!providerSlug) {
    console.log(chalk.red('Provider type is required.'));
    console.log(chalk.dim('Available: ' + PROVIDERS.map((p) => p.slug).join(', ')));
    process.exit(1);
  }

  const meta = PROVIDERS.find((p) => p.slug === providerSlug);
  if (!meta) {
    console.log(chalk.red(`Unknown provider: ${providerSlug}`));
    console.log(chalk.dim('Available: ' + PROVIDERS.map((p) => p.slug).join(', ')));
    process.exit(1);
  }

  console.log(chalk.bold(`Configuring ${meta.displayName}...`));

  // Prompt for display name
  const { displayName } = await prompts({
    name: 'displayName',
    message: 'Display name for this account',
    type: 'text',
    initial: meta.displayName,
  });

  if (!displayName) {
    console.log(chalk.yellow('Cancelled.'));
    return;
  }

  // Prompt for credentials
  const credentials: Record<string, string> = {};
  for (const prompt of meta.credentialPrompts) {
    const initial =
      typeof prompt.initial === 'function'
        ? prompt.initial(credentials)
        : prompt.initial;
    const { value } = await prompts({
      name: 'value',
      message: prompt.message,
      type: prompt.type as 'text',
      initial: initial || undefined,
    });
    if (value === undefined) {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }
    credentials[prompt.name] = value;
  }

  const now = new Date().toISOString();
  const config: ProviderConfig = {
    id: randomUUID(),
    provider: meta.slug,
    displayName,
    credentials,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  const db = openDB();
  try {
    db.upsertProvider(config);
    console.log(chalk.green(`✓ Provider "${displayName}" (${meta.slug}) saved with ID ${config.id.slice(0, 8)}`));
  } finally {
    db.close();
  }
}

// ── Subcommand: remove ───────────────────────────────────────────────────

async function cmdRemove(providerIdOrName: string | undefined): Promise<void> {
  if (!providerIdOrName) {
    console.log(chalk.red('Provider ID or name is required.'));
    process.exit(1);
  }

  const db = openDB();
  try {
    const all = db.listProviders();
    let target = all.find(
      (p) => p.id === providerIdOrName || p.id.startsWith(providerIdOrName!),
    );
    if (!target) {
      target = all.find((p) => p.provider === providerIdOrName);
    }

    if (!target) {
      console.log(chalk.red(`Provider not found: ${providerIdOrName}`));
      return;
    }

    const { confirm } = await prompts({
      name: 'confirm',
      message: `Remove "${target.displayName}" (${target.provider})?`,
      type: 'confirm',
      initial: false,
    });

    if (!confirm) {
      console.log(chalk.yellow('Cancelled.'));
      return;
    }

    db.deleteProvider(target.id);
    console.log(chalk.green(`✓ Removed "${target.displayName}"`));
  } finally {
    db.close();
  }
}

// ── Subcommand: test ─────────────────────────────────────────────────────

async function cmdTest(providerIdOrName: string | undefined): Promise<void> {
  if (!providerIdOrName) {
    console.log(chalk.red('Provider ID or name is required.'));
    process.exit(1);
  }

  const db = openDB();
  try {
    const all = db.listProviders();
    let target = all.find(
      (p) => p.id === providerIdOrName || p.id.startsWith(providerIdOrName!),
    );
    if (!target) {
      target = all.find((p) => p.provider === providerIdOrName);
    }

    if (!target) {
      console.log(chalk.red(`Provider not found: ${providerIdOrName}`));
      return;
    }

    const meta = PROVIDERS.find((p) => p.slug === target!.provider);
    if (!meta) {
      console.log(chalk.red(`No adapter registered for provider: ${target.provider}`));
      return;
    }

    console.log(chalk.dim(`Testing connection to ${meta.displayName}...`));

    const result = await fetchWithRefresh(target, meta.adapter);

    if (result.status === 'ok') {
      console.log(chalk.green(`✓ Connection successful!`));
      console.log(chalk.dim(`  Plan: ${result.plan}`));
      for (const w of result.windows) {
        const usedPct = (100 - w.remainingPct).toFixed(1);
        console.log(
          `  ${w.name}: ${w.used} ${w.unit} used (${usedPct}%)`,
        );
      }
    } else {
      console.log(chalk.red(`✗ ${result.status}: ${result.error ?? 'Unknown error'}`));
    }
  } finally {
    db.close();
  }
}

// ── Register command ─────────────────────────────────────────────────────

export function registerConfigCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Manage provider configurations');

  config
    .command('list')
    .description('Show configured providers')
    .action(() => cmdList());

  config
    .command('add')
    .description('Add a provider interactively')
    .argument('[provider]', `Provider type (${PROVIDERS.map((p) => p.slug).join(', ')})`)
    .action((provider: string) => cmdAdd(provider));

  config
    .command('remove')
    .description('Remove a provider')
    .argument('<provider>', 'Provider ID or name')
    .action((provider: string) => cmdRemove(provider));

  config
    .command('test')
    .description('Test connection to a provider')
    .argument('<provider>', 'Provider ID or name')
    .action((provider: string) => cmdTest(provider));
}
