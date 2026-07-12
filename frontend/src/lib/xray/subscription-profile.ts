import type { StreamSettings } from '@/schemas/api/inbound';
import type { ExternalProxyEntry } from '@/schemas/protocols/stream/external-proxy';


export function createSubscriptionProfileDraft(
  defaultAddress = '',
  defaultPort = 443,
): ExternalProxyEntry {
  const safePort = Number.isInteger(defaultPort) && defaultPort > 0 && defaultPort <= 65535
    ? defaultPort
    : 443;

  return {
    enabled: true,
    remark: '',
    dest: defaultAddress,
    port: safePort,
    network: 'same',
    security: 'same',
    forceTls: 'same',
    excludeFromSubTypes: [],
    mihomoX25519: false,
    shuffleHost: false,
  };
}

export interface SubscriptionProfileEndpoint {
  address: string;
  port: number;
  remark: string;
  streamSettings: StreamSettings;
  profile: ExternalProxyEntry | null;
}

const TRANSPORT_KEYS = [
  'tcpSettings',
  'kcpSettings',
  'wsSettings',
  'grpcSettings',
  'httpupgradeSettings',
  'xhttpSettings',
  'hysteriaSettings',
] as const;

type MutableStream = Record<string, unknown>;
type MutableProfile = ExternalProxyEntry & Record<string, unknown>;

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function transportKey(network: string): (typeof TRANSPORT_KEYS)[number] | null {
  switch (network) {
    case 'tcp': return 'tcpSettings';
    case 'kcp': return 'kcpSettings';
    case 'ws': return 'wsSettings';
    case 'grpc': return 'grpcSettings';
    case 'httpupgrade': return 'httpupgradeSettings';
    case 'xhttp': return 'xhttpSettings';
    case 'hysteria': return 'hysteriaSettings';
    default: return null;
  }
}

function defaultTransportSettings(network: string): Record<string, unknown> {
  switch (network) {
    case 'tcp':
      return { acceptProxyProtocol: false, header: { type: 'none' } };
    case 'ws':
      return { acceptProxyProtocol: false, path: '/', host: '', headers: {}, heartbeatPeriod: 0 };
    case 'grpc':
      return { serviceName: '', authority: '', multiMode: false };
    case 'httpupgrade':
      return { acceptProxyProtocol: false, path: '/', host: '', headers: {} };
    case 'xhttp':
      return { path: '/', host: '', mode: 'auto', headers: {} };
    default:
      return {};
  }
}

function defaultTlsSettings(): Record<string, unknown> {
  return {
    serverName: '',
    alpn: [],
    settings: {
      fingerprint: 'chrome',
      echConfigList: '',
      pinnedPeerCertSha256: [],
      allowInsecure: false,
    },
  };
}

function defaultRealitySettings(): Record<string, unknown> {
  return {
    serverNames: [],
    shortIds: [],
    settings: {
      publicKey: '',
      fingerprint: 'chrome',
      serverName: '',
      spiderX: '/',
      mldsa65Verify: '',
    },
  };
}

function applyLegacyTlsFields(profile: MutableProfile, stream: MutableStream): void {
  const tls = (stream.tlsSettings && typeof stream.tlsSettings === 'object')
    ? stream.tlsSettings as Record<string, unknown>
    : defaultTlsSettings();
  stream.tlsSettings = tls;

  if (profile.sni) tls.serverName = profile.sni;
  if (Array.isArray(profile.alpn) && profile.alpn.length > 0) tls.alpn = [...profile.alpn];

  const settings = (tls.settings && typeof tls.settings === 'object')
    ? tls.settings as Record<string, unknown>
    : {};
  tls.settings = settings;
  if (profile.fingerprint) settings.fingerprint = profile.fingerprint;
  if (Array.isArray(profile.pinnedPeerCertSha256) && profile.pinnedPeerCertSha256.length > 0) {
    settings.pinnedPeerCertSha256 = [...profile.pinnedPeerCertSha256];
  }
  if (profile.echConfigList) settings.echConfigList = profile.echConfigList;
  if (typeof profile.allowInsecure === 'boolean') settings.allowInsecure = profile.allowInsecure;
}

export function effectiveSubscriptionProfileStream(
  base: StreamSettings,
  profile: ExternalProxyEntry,
): StreamSettings {
  const stream = jsonClone(base) as unknown as MutableStream;
  delete stream.externalProxy;
  const mutableProfile = profile as MutableProfile;

  const baseNetwork = typeof stream.network === 'string' ? stream.network : '';
  const selectedNetwork = profile.network && profile.network !== 'same'
    ? profile.network
    : baseNetwork;
  const selectedTransportKey = transportKey(selectedNetwork);
  if (selectedTransportKey) {
    if (selectedNetwork !== baseNetwork) {
      for (const key of TRANSPORT_KEYS) delete stream[key];
      stream.network = selectedNetwork;
      stream[selectedTransportKey] = defaultTransportSettings(selectedNetwork);
    }
    const profileSettings = mutableProfile[selectedTransportKey];
    if (profileSettings && typeof profileSettings === 'object') {
      stream[selectedTransportKey] = jsonClone(profileSettings);
    } else if (!stream[selectedTransportKey]) {
      stream[selectedTransportKey] = defaultTransportSettings(selectedNetwork);
    }
  }

  let security = profile.security;
  if (!security || security === 'same') security = profile.forceTls;
  if (!security || security === 'same') {
    security = typeof stream.security === 'string' ? stream.security as 'none' | 'tls' | 'reality' : 'none';
  }

  switch (security) {
    case 'none':
      stream.security = 'none';
      delete stream.tlsSettings;
      delete stream.realitySettings;
      break;
    case 'tls':
      stream.security = 'tls';
      delete stream.realitySettings;
      if (profile.tlsSettings) stream.tlsSettings = jsonClone(profile.tlsSettings);
      else if (!stream.tlsSettings) stream.tlsSettings = defaultTlsSettings();
      applyLegacyTlsFields(mutableProfile, stream);
      break;
    case 'reality':
      stream.security = 'reality';
      delete stream.tlsSettings;
      if (profile.realitySettings) stream.realitySettings = jsonClone(profile.realitySettings);
      else if (!stream.realitySettings) stream.realitySettings = defaultRealitySettings();
      break;
    default:
      break;
  }

  if (profile.finalmask) stream.finalmask = jsonClone(profile.finalmask);
  return stream as unknown as StreamSettings;
}

export function expandSubscriptionProfileEndpoints(
  streamSettings: StreamSettings,
  defaultAddress: string,
  defaultPort: number,
): SubscriptionProfileEndpoint[] {
  const profiles = streamSettings.externalProxy;
  if (!profiles || profiles.length === 0) {
    const stream = jsonClone(streamSettings) as unknown as MutableStream;
    delete stream.externalProxy;
    return [{
      address: defaultAddress,
      port: defaultPort,
      remark: '',
      streamSettings: stream as unknown as StreamSettings,
      profile: null,
    }];
  }

  return profiles
    .filter((profile) => profile.enabled !== false)
    .map((profile) => ({
      address: profile.dest?.trim() || defaultAddress,
      port: Number.isInteger(profile.port) && profile.port > 0 && profile.port <= 65535
        ? profile.port
        : defaultPort,
      remark: profile.remark ?? '',
      streamSettings: effectiveSubscriptionProfileStream(streamSettings, profile),
      profile,
    }));
}

export interface DefaultSubscriptionPortPair {
  inboundPort: number | null;
  profilePort: number | null;
}

export interface DefaultSubscriptionPortSyncState
  extends DefaultSubscriptionPortPair {
  linked: boolean;
  pending: DefaultSubscriptionPortPair | null;
}

export interface DefaultSubscriptionPortSyncPlan {
  state: DefaultSubscriptionPortSyncState;
  setInboundPort?: number;
  setProfilePort?: number;
}

export function normalizeSubscriptionPort(value: unknown): number | null {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 1
    || value > 65535
  ) {
    return null;
  }
  return value;
}

function portPairsEqual(
  left: DefaultSubscriptionPortPair,
  right: DefaultSubscriptionPortPair,
): boolean {
  return left.inboundPort === right.inboundPort
    && left.profilePort === right.profilePort;
}

function portsAreLinked(pair: DefaultSubscriptionPortPair): boolean {
  return pair.inboundPort !== null
    && pair.profilePort !== null
    && pair.inboundPort === pair.profilePort;
}

function createPortSyncState(
  pair: DefaultSubscriptionPortPair,
): DefaultSubscriptionPortSyncState {
  return {
    ...pair,
    linked: portsAreLinked(pair),
    pending: null,
  };
}

// Profile zero is the default endpoint. While its port equals the inbound
// port, editing either side keeps both synchronized. Existing imported or
// intentionally divergent profiles remain independent until equalized again.
export function planDefaultSubscriptionPortSync(
  previous: DefaultSubscriptionPortSyncState | null,
  current: DefaultSubscriptionPortPair,
): DefaultSubscriptionPortSyncPlan {
  if (previous === null) {
    return { state: createPortSyncState(current) };
  }

  if (previous.pending !== null) {
    if (portPairsEqual(current, previous.pending)) {
      return {
        state: {
          ...current,
          linked: true,
          pending: null,
        },
      };
    }

    // setFieldValue can produce an intermediate render. Do not reverse the
    // synchronization while waiting for the target field to update.
    return { state: previous };
  }

  const inboundChanged = current.inboundPort !== previous.inboundPort;
  const profileChanged = current.profilePort !== previous.profilePort;

  if (!previous.linked) {
    return { state: createPortSyncState(current) };
  }

  if (!inboundChanged && !profileChanged) {
    return { state: previous };
  }

  if (inboundChanged && !profileChanged) {
    if (current.inboundPort === null) {
      return { state: previous };
    }

    const target = {
      inboundPort: current.inboundPort,
      profilePort: current.inboundPort,
    };

    return {
      state: {
        ...target,
        linked: true,
        pending: target,
      },
      setProfilePort: current.inboundPort,
    };
  }

  if (profileChanged && !inboundChanged) {
    if (current.profilePort === null) {
      return { state: previous };
    }

    const target = {
      inboundPort: current.profilePort,
      profilePort: current.profilePort,
    };

    return {
      state: {
        ...target,
        linked: true,
        pending: target,
      },
      setInboundPort: current.profilePort,
    };
  }

  // Initialization/import may change both values simultaneously.
  return { state: createPortSyncState(current) };
}
