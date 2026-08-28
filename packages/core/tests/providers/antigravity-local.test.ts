import { describe, it, expect } from 'vitest';
import {
  extractArgument,
  parseProcessList,
  parseListenPorts,
  parseUserStatus,
} from '../../src/providers/antigravity-local.js';

const PS_ROW =
  'yufo  60908  11.3  1.1 491317296 547136 ??  S  2:37AM  4:45.70 ' +
  '/Applications/Antigravity.app/Contents/Resources/bin/language_server --standalone ' +
  '--override_ide_name antigravity --csrf_token=abc123 --extension_server_port 54321';

describe('extractArgument', () => {
  it('parses --name=value', () => {
    expect(extractArgument(PS_ROW, '--csrf_token')).toBe('abc123');
  });
  it('parses --name value', () => {
    expect(extractArgument(PS_ROW, '--extension_server_port')).toBe('54321');
  });
  it('strips surrounding quotes', () => {
    expect(extractArgument('foo --csrf_token="quoted tok" bar', '--csrf_token')).toBe('quoted tok');
  });
  it('returns null when absent', () => {
    expect(extractArgument('nothing here', '--csrf_token')).toBeNull();
  });
});

describe('parseProcessList', () => {
  it('finds the language server and extracts token + port', () => {
    const out = `USER PID %CPU %MEM VSZ RSS TT STAT STARTED TIME COMMAND\n${PS_ROW}\n`;
    const found = parseProcessList(out);
    expect(found).toEqual({ pid: 60908, csrfToken: 'abc123', extensionServerPort: 54321 });
  });

  it('ignores helper processes without server signals', () => {
    const helper =
      'yufo  60938  0.0  0.1 539561856 51296 ??  S  2:38AM  0:03.96 ' +
      '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper --type=utility';
    expect(parseProcessList(`header\n${helper}\n`)).toBeNull();
  });

  it('ignores the installation script', () => {
    const installer =
      'yufo  1  0.0  0.1 1000 100 ??  S  1:00AM  0:01.00 bash antigravity server installation script --csrf_token=x';
    expect(parseProcessList(`header\n${installer}\n`)).toBeNull();
  });

  it('returns null when no antigravity process exists', () => {
    expect(parseProcessList('USER PID\nroot 1 launchd\n')).toBeNull();
  });
});

describe('parseListenPorts', () => {
  it('parses macOS lsof output', () => {
    const lsof =
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\n' +
      'language_ 60908 yufo   12u  IPv4 0x123      0t0  TCP 127.0.0.1:54321 (LISTEN)\n' +
      'language_ 60908 yufo   13u  IPv4 0x124      0t0  TCP 127.0.0.1:54322 (LISTEN)\n';
    expect(parseListenPorts(lsof)).toEqual([54321, 54322]);
  });

  it('dedupes ports', () => {
    const lsof =
      'a 1 u IPv4 0x1 0t0 TCP *:8080 (LISTEN)\nb 1 u IPv6 0x2 0t0 TCP *:8080 (LISTEN)\n';
    expect(parseListenPorts(lsof)).toEqual([8080]);
  });
});

describe('parseUserStatus', () => {
  it('extracts email, prompt credits and model quotas from userStatus wrapper', () => {
    const parsed = parseUserStatus({
      userStatus: {
        email: 'a@b.c',
        planStatus: { availablePromptCredits: 880, planInfo: { monthlyPromptCredits: 1000 } },
        cascadeModelConfigData: {
          clientModelConfigs: [
            {
              modelOrAlias: { model: 'gemini-3-flash' },
              label: 'Gemini 3 Flash',
              quotaInfo: { remainingFraction: 0.9, resetTime: '2026-08-28T15:00:00Z' },
            },
            { modelOrAlias: { model: 'claude-sonnet' }, quotaInfo: {} },
          ],
        },
      },
    });
    expect(parsed.email).toBe('a@b.c');
    expect(parsed.promptCredits).toEqual({ used: 120, limit: 1000, remaining: 880 });
    expect(parsed.models).toHaveLength(2);
    expect(parsed.models[0]).toMatchObject({ modelId: 'gemini-3-flash', label: 'Gemini 3 Flash', remainingFraction: 0.9 });
    expect(parsed.models[1]!.remainingFraction).toBeUndefined();
  });

  it('accepts a bare response without the userStatus wrapper', () => {
    const parsed = parseUserStatus({ email: 'x@y.z' });
    expect(parsed.email).toBe('x@y.z');
    expect(parsed.models).toEqual([]);
  });

  it('tolerates garbage', () => {
    expect(parseUserStatus(null)).toEqual({ models: [] });
    expect(parseUserStatus('nope')).toEqual({ models: [] });
    expect(parseUserStatus({ userStatus: { planStatus: { availablePromptCredits: 'x' } } }).promptCredits).toBeUndefined();
  });
});
