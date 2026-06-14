import { describe, expect, it } from 'vitest';

import type { StreamSettings } from '@/schemas/api/inbound';
import { expandSubscriptionProfileEndpoints } from '@/lib/xray/subscription-profile';

function baseStream(): StreamSettings {
  return {
    network: 'tcp',
    tcpSettings: {
      acceptProxyProtocol: false,
      header: { type: 'none' },
    },
    security: 'none',
  };
}

describe('subscription profile expansion', () => {
  it('keeps the legacy single default configuration when profiles are absent', () => {
    const endpoints = expandSubscriptionProfileEndpoints(baseStream(), 'node.example.com', 27543);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      address: 'node.example.com',
      port: 27543,
      remark: '',
      profile: null,
    });
    expect(endpoints[0].streamSettings.externalProxy).toBeUndefined();
  });

  it('filters disabled profiles and applies independent WS/TLS settings', () => {
    const stream: StreamSettings = {
      ...baseStream(),
      externalProxy: [
        {
          enabled: false,
          remark: 'disabled',
          dest: 'disabled.example.com',
          port: 443,
          network: 'same',
          security: 'same',
          forceTls: 'same',
        },
        {
          enabled: true,
          remark: 'ws-tls',
          dest: 'cdn.example.com',
          port: 8443,
          network: 'ws',
          security: 'tls',
          forceTls: 'same',
          wsSettings: {
            acceptProxyProtocol: false,
            path: '/secx',
            host: 'origin.example.com',
            headers: {},
            heartbeatPeriod: 0,
          },
          tlsSettings: {
            serverName: 'sni.example.com',
            alpn: ['h2'],
            settings: {
              fingerprint: 'chrome',
              echConfigList: '',
              pinnedPeerCertSha256: [],
              allowInsecure: true,
            },
          },
        },
      ],
    };

    const endpoints = expandSubscriptionProfileEndpoints(stream, 'node.example.com', 27543);

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].address).toBe('cdn.example.com');
    expect(endpoints[0].port).toBe(8443);
    expect(endpoints[0].streamSettings.network).toBe('ws');
    expect(endpoints[0].streamSettings.security).toBe('tls');
    if (endpoints[0].streamSettings.network !== 'ws') throw new Error('expected ws');
    expect(endpoints[0].streamSettings.wsSettings.path).toBe('/secx');
    expect('tcpSettings' in endpoints[0].streamSettings).toBe(false);
    if (endpoints[0].streamSettings.security !== 'tls') throw new Error('expected tls');
    expect(endpoints[0].streamSettings.tlsSettings.serverName).toBe('sni.example.com');
  });

  it('returns no configurations when a configured profile list is fully disabled', () => {
    const stream: StreamSettings = {
      ...baseStream(),
      externalProxy: [
        {
          enabled: false,
          remark: 'one',
          dest: 'one.example.com',
          port: 443,
          network: 'same',
          security: 'same',
          forceTls: 'same',
        },
      ],
    };

    expect(expandSubscriptionProfileEndpoints(stream, 'node.example.com', 27543)).toEqual([]);
  });

  it('keeps legacy forceTls/SNI fields working', () => {
    const stream: StreamSettings = {
      ...baseStream(),
      externalProxy: [
        {
          enabled: true,
          remark: 'legacy',
          dest: 'legacy.example.com',
          port: 443,
          network: 'same',
          security: 'same',
          forceTls: 'tls',
          sni: 'sni.example.com',
          fingerprint: 'firefox',
          alpn: ['h2'],
        },
      ],
    };

    const [endpoint] = expandSubscriptionProfileEndpoints(stream, 'node.example.com', 27543);
    expect(endpoint.streamSettings.security).toBe('tls');
    if (endpoint.streamSettings.security !== 'tls') throw new Error('expected tls');
    expect(endpoint.streamSettings.tlsSettings.serverName).toBe('sni.example.com');
    expect(endpoint.streamSettings.tlsSettings.settings.fingerprint).toBe('firefox');
  });
});
