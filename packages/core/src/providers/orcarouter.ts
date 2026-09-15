import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, quotaError, quotaOk } from './base.js';

/**
 * OrcaRouter pay-as-you-go balance (NOT a subscription quota).
 *
 * GET /v1/balance — verified live 2026-09:
 *   { object: "balance", unit: "USD", paid_balance: 19.97…,
 *     free_credit: [{ model: "orca/dub", balance: 6, balance_usd: 6 }],
 *     promo_credits: [] }
 * Balances are current remaining amounts — no "used" figure, so each window
 * models total = remaining = balance (used 0), like the DeepSeek adapter.
 */
const BALANCE_URL = 'https://api.orcarouter.ai/v1/balance';

interface OrcaBalanceResponse {
  unit?: string;
  paid_balance?: number;
  free_credit?: Array<{
    model?: string;
    balance?: number;
    balance_usd?: number;
  }>;
}

export const orcarouterProvider: ProviderAdapter = {
  id: 'orcarouter',
  displayName: 'OrcaRouter',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const apiKey = config.credentials.apiKey ?? config.credentials.token;
    if (!apiKey) {
      return quotaError('orcarouter', config, 'not_configured', 'No API key configured');
    }

    const res = await fetchJson<OrcaBalanceResponse>(BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('orcarouter', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('orcarouter', config, 'error', res.error);
    }

    const windows: QuotaWindow[] = [];
    // An unparseable balance must NOT degrade to 0 (a fake "bankrupt").
    if (typeof res.data.paid_balance === 'number' && Number.isFinite(res.data.paid_balance)) {
      const balance = res.data.paid_balance;
      windows.push({
        name: 'balance (USD)',
        kind: 'balance',
        used: 0,
        total: balance,
        unit: 'usd',
        remaining: balance,
        remainingPct: balance > 0 ? 100 : 0,
        resetAt: null,
        unlimited: false,
      });
    }
    for (const credit of res.data.free_credit ?? []) {
      const balance = credit.balance_usd ?? credit.balance;
      if (typeof balance !== 'number' || !Number.isFinite(balance)) continue;
      windows.push({
        name: `free credit (${credit.model ?? '?'})`,
        kind: 'balance',
        used: 0,
        total: balance,
        unit: 'usd',
        remaining: balance,
        remainingPct: balance > 0 ? 100 : 0,
        resetAt: null,
        unlimited: false,
      });
    }
    if (windows.length === 0) {
      return quotaError('orcarouter', config, 'error', 'balance response had no parseable balances');
    }

    return quotaOk('orcarouter', config.id, 'PAYG', windows);
  },
};
