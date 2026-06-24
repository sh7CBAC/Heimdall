import { z } from 'zod';

import { PortSchema } from '@/schemas/primitives';
import { RealityClientSettingsSchema } from '@/schemas/protocols/security/reality';
import {
  AlpnSchema,
  TlsClientSettingsSchema,
  UtlsFingerprintSchema,
} from '@/schemas/protocols/security/tls';

import { FinalMaskStreamSettingsSchema } from './finalmask';
import { GrpcStreamSettingsSchema } from './grpc';
import { HttpUpgradeStreamSettingsSchema } from './httpupgrade';
import { KcpStreamSettingsSchema } from './kcp';
import { TcpStreamSettingsSchema } from './tcp';
import { WsStreamSettingsSchema } from './ws';
import { XHttpStreamSettingsSchema } from './xhttp';

// `forceTls` is the historical External Proxy switch. It remains on the wire
// so existing rows and older nodes keep working. New subscription profiles use
// `security`; generators fall back to forceTls when security is absent/same.
export const ExternalProxyForceTlsSchema = z.enum(['same', 'tls', 'none']);
export type ExternalProxyForceTls = z.infer<typeof ExternalProxyForceTlsSchema>;

export const SubscriptionProfileNetworkSchema = z.enum([
  'same',
  'tcp',
  'kcp',
  'ws',
  'grpc',
  'httpupgrade',
  'xhttp',
]);
export type SubscriptionProfileNetwork = z.infer<typeof SubscriptionProfileNetworkSchema>;

export const SubscriptionProfileSecuritySchema = z.enum([
  'same',
  'none',
  'tls',
  'reality',
]);
export type SubscriptionProfileSecurity = z.infer<typeof SubscriptionProfileSecuritySchema>;

export const SubscriptionProfileSubTypeSchema = z.enum(['raw', 'json', 'clash']);
export type SubscriptionProfileSubType = z.infer<typeof SubscriptionProfileSubTypeSchema>;

export const SubscriptionProfileMihomoIpVersionSchema = z.enum([
  'dual',
  'ipv4',
  'ipv6',
  'ipv4-prefer',
  'ipv6-prefer',
]);
export type SubscriptionProfileMihomoIpVersion = z.infer<typeof SubscriptionProfileMihomoIpVersionSchema>;

export const SubscriptionProfileVlessRouteSchema = z.preprocess(
  (val) => {
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    return trimmed === '' ? undefined : trimmed;
  },
  z.string()
    .regex(
      /^(\d{1,5}(-\d{1,5})?)(\s*,\s*\d{1,5}(-\d{1,5})?)*$/,
      'pages.hosts.toasts.badVlessRoute',
    )
    .optional(),
);

// Client-only TLS shape. Server certificates/private keys are deliberately not
// accepted here because subscription profiles never become Xray inbounds.
export const SubscriptionProfileTlsSettingsSchema = z.object({
  serverName: z.string().default(''),
  alpn: z.array(AlpnSchema).default([]),
  settings: TlsClientSettingsSchema.extend({
    allowInsecure: z.boolean().default(false),
  }).default({
    fingerprint: 'chrome',
    echConfigList: '',
    pinnedPeerCertSha256: [],
    verifyPeerCertByName: '',
    allowInsecure: false,
  }),
});
export type SubscriptionProfileTlsSettings = z.infer<typeof SubscriptionProfileTlsSettingsSchema>;

// Client-only Reality shape. Private key/seed/target are server-side values and
// are intentionally excluded from a virtual subscription profile.
export const SubscriptionProfileRealitySettingsSchema = z.object({
  serverNames: z.array(z.string()).default([]),
  shortIds: z.array(z.string()).default([]),
  settings: RealityClientSettingsSchema.default({
    publicKey: '',
    fingerprint: 'chrome',
    serverName: '',
    spiderX: '/',
    mldsa65Verify: '',
  }),
});
export type SubscriptionProfileRealitySettings = z.infer<typeof SubscriptionProfileRealitySettingsSchema>;

// Per-profile outbound Mux override used by JSON subscriptions. Absence means
// inherit the global subscription Mux setting; enabled=false explicitly turns
// Mux off for this profile.
export const SubscriptionProfileMuxSchema = z.object({
  enabled: z.boolean().default(true),
  concurrency: z.number().int().default(8),
  xudpConcurrency: z.number().int().default(16),
  xudpProxyUDP443: z.enum(['reject', 'allow', 'skip']).default('reject'),
});
export type SubscriptionProfileMux = z.infer<typeof SubscriptionProfileMuxSchema>;

// One inbound can advertise several complete client-side connection profiles.
// Protocol and client identity remain owned by the parent inbound; address,
// port, transport, security and client-only stream settings can be overridden.
export const ExternalProxyEntrySchema = z.object({
  enabled: z.boolean().optional(),
  remark: z.string().default(''),
  dest: z.string().default(''),
  port: PortSchema.default(443),

  network: SubscriptionProfileNetworkSchema.optional(),
  security: SubscriptionProfileSecuritySchema.optional(),

  tcpSettings: TcpStreamSettingsSchema.optional(),
  kcpSettings: KcpStreamSettingsSchema.optional(),
  wsSettings: WsStreamSettingsSchema.optional(),
  grpcSettings: GrpcStreamSettingsSchema.optional(),
  httpupgradeSettings: HttpUpgradeStreamSettingsSchema.optional(),
  xhttpSettings: XHttpStreamSettingsSchema.optional(),
  tlsSettings: SubscriptionProfileTlsSettingsSchema.optional(),
  realitySettings: SubscriptionProfileRealitySettingsSchema.optional(),
  finalmask: FinalMaskStreamSettingsSchema.optional(),
  mux: SubscriptionProfileMuxSchema.optional(),

  // Heimdall phase-1 parity with Managed Hosts.
  excludeFromSubTypes: z.array(SubscriptionProfileSubTypeSchema).optional(),
  vlessRoute: SubscriptionProfileVlessRouteSchema,
  mihomoIpVersion: z.preprocess(
    (val) => (val === '' ? undefined : val),
    SubscriptionProfileMihomoIpVersionSchema.optional(),
  ),
  mihomoX25519: z.boolean().optional(),
  shuffleHost: z.boolean().optional(),

  // Legacy External Proxy fields. They are still read and emitted so old
  // configurations remain byte-compatible until a later explicit migration.
  forceTls: ExternalProxyForceTlsSchema.default('same'),
  sni: z.string().optional(),
  fingerprint: z.preprocess(
    (val) => (val === '' ? undefined : val),
    UtlsFingerprintSchema.optional(),
  ),
  alpn: z.array(AlpnSchema).optional(),
  pinnedPeerCertSha256: z.array(z.string()).optional(),
  verifyPeerCertByName: z.string().optional(),
  echConfigList: z.string().optional(),
  allowInsecure: z.boolean().optional(),
});
export type ExternalProxyEntry = z.infer<typeof ExternalProxyEntrySchema>;
