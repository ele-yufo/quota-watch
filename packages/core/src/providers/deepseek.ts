import type { ProviderAdapter } from './types.js';
import type { ProviderConfig, ProviderQuota, QuotaWindow } from '../types.js';
import { fetchJson, httpStatusToQuotaStatus, quotaError, quotaOk } from './base.js';

/**
 * DeepSeek pay-as-you-go balance (NOT a subscription quota).
 *
 * GET /user/balance — verified live 2026-09:
 *   { is_available, balance_infos: [{ currency, total_balance,
 *     granted_balance, topped_up_balance }] }
 * All amounts are strings. There is no "used" figure — the API only knows the
 * CURRENT remaining balance, so the window models total = remaining = balance
 * (used 0). The web UI renders balance-kind windows as an absolute amount,
 * not a percentage.
 */
const BALANCE_URL = 'https://api.deepseek.com/user/balance';

interface DeepSeekBalanceResponse {
  is_available?: boolean;
  balance_infos?: Array<{
    currency?: string;
    total_balance?: string;
    granted_balance?: string;
    topped_up_balance?: string;
  }>;
}

export const deepseekProvider: ProviderAdapter = {
  id: 'deepseek',
  displayName: 'DeepSeek',

  async fetchQuota(config: ProviderConfig): Promise<ProviderQuota> {
    const apiKey = config.credentials.apiKey ?? config.credentials.token;
    if (!apiKey) {
      return quotaError('deepseek', config, 'not_configured', 'No API key configured');
    }

    const res = await fetchJson<DeepSeekBalanceResponse>(BALANCE_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      if (res.status !== null) {
        return quotaError('deepseek', config, httpStatusToQuotaStatus(res.status), res.error);
      }
      return quotaError('deepseek', config, 'error', res.error);
    }

    // One entry per currency the account holds (usually just CNY).
    const windows: QuotaWindow[] = [];
    for (const info of res.data.balance_infos ?? []) {
      const balance = Number(info.total_balance);
      // An unparseable balance must NOT degrade to 0 (a fake "bankrupt").
      if (!Number.isFinite(balance)) continue;
      const unit = info.currency === 'USD' ? 'usd' : info.currency === 'CNY' ? 'cny' : 'unknown';
      windows.push({
        name: `balance (${info.currency ?? '?'})`,
        kind: 'balance',
        used: 0,
        total: balance,
        unit,
        remaining: balance,
        remainingPct: balance > 0 ? 100 : 0,
        resetAt: null,
        unlimited: false,
      });
    }
    if (windows.length === 0) {
      return quotaError('deepseek', config, 'error', 'balance response had no parseable balance_infos');
    }

    return quotaOk('deepseek', config.id, 'PAYG', windows);
  },
};
