import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormContext, useWatch } from 'react-hook-form';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  type FormInstance,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  RightOutlined,
  DownOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import { HeaderMapEditor } from '@/components/form';
import { FinalMaskForm } from '@/lib/xray/forms/transport';
import ClientSockoptForm from '@/pages/hosts/json-forms/HostSockoptForm';
import { canEnableReality, canEnableTls } from '@/lib/xray/protocol-capabilities';
import { ALPN_OPTION, UTLS_FINGERPRINT } from '@/schemas/primitives';
import {
  SubscriptionProfileMuxSchema,
  SubscriptionProfileRealitySettingsSchema,
  SubscriptionProfileTlsSettingsSchema,
} from '@/schemas/protocols/stream/external-proxy';
import { GrpcStreamSettingsSchema } from '@/schemas/protocols/stream/grpc';
import { HttpUpgradeStreamSettingsSchema } from '@/schemas/protocols/stream/httpupgrade';
import { KcpStreamSettingsSchema } from '@/schemas/protocols/stream/kcp';
import { TcpStreamSettingsSchema } from '@/schemas/protocols/stream/tcp';
import { WsStreamSettingsSchema } from '@/schemas/protocols/stream/ws';
import { XHttpStreamSettingsSchema, XHttpXmuxSchema } from '@/schemas/protocols/stream/xhttp';

interface SubscriptionProfileEditorProps {
  fieldName: number;
  displayIndex: number;
  totalProfiles: number;
  form: FormInstance;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function Field({ label, children, hint }: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="ext-proxy-field">
      <span className="ext-proxy-flabel">{label}</span>
      {children}
      {hint && <span className="ext-proxy-fhint">{hint}</span>}
    </div>
  );
}

function transportDefaults(network: string): Record<string, unknown> {
  switch (network) {
    case 'tcp':
      return TcpStreamSettingsSchema.parse({ header: { type: 'none' } });
    case 'kcp':
      return KcpStreamSettingsSchema.parse({});
    case 'ws':
      return WsStreamSettingsSchema.parse({});
    case 'grpc':
      return GrpcStreamSettingsSchema.parse({});
    case 'httpupgrade':
      return HttpUpgradeStreamSettingsSchema.parse({});
    case 'xhttp':
      return XHttpStreamSettingsSchema.parse({});
    default:
      return {};
  }
}

function transportSettingsKey(network: string): string | null {
  switch (network) {
    case 'tcp': return 'tcpSettings';
    case 'kcp': return 'kcpSettings';
    case 'ws': return 'wsSettings';
    case 'grpc': return 'grpcSettings';
    case 'httpupgrade': return 'httpupgradeSettings';
    case 'xhttp': return 'xhttpSettings';
    default: return null;
  }
}

export default function SubscriptionProfileEditor({
  fieldName,
  displayIndex,
  totalProfiles,
  form,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: SubscriptionProfileEditorProps) {
  const { t } = useTranslation();
  const base = useMemo<(string | number)[]>(
    () => ['streamSettings', 'externalProxy', fieldName],
    [fieldName],
  );

  const { control } = useFormContext();
  const protocol = (useWatch({ control, name: 'protocol' }) ?? '') as string;
  const parentNetwork = (Form.useWatch(['streamSettings', 'network'], form) ?? 'tcp') as string;
  const parentSecurity = (Form.useWatch(['streamSettings', 'security'], form) ?? 'none') as string;
  const enabled = Form.useWatch([...base, 'enabled'], form);
  const remark = (Form.useWatch([...base, 'remark'], form) ?? '') as string;
  const destination = (Form.useWatch([...base, 'dest'], form) ?? '') as string;
  const selectedNetwork = (Form.useWatch([...base, 'network'], form) ?? 'same') as string;
  const selectedSecurity = (Form.useWatch([...base, 'security'], form) ?? 'same') as string;
  const legacyForceTls = (Form.useWatch([...base, 'forceTls'], form) ?? 'same') as string;
  const finalMask = Form.useWatch([...base, 'finalmask'], { form, preserve: true });
  const mux = Form.useWatch([...base, 'mux'], { form, preserve: true }) as
    | { enabled?: boolean; concurrency?: number; xudpConcurrency?: number; xudpProxyUDP443?: string }
    | undefined;
  const sockopt = Form.useWatch(
    [...base, 'sockopt'],
    { form, preserve: true },
  ) as Record<string, unknown> | undefined;
  const muxMode = mux === undefined ? 'same' : (mux.enabled === false ? 'disabled' : 'enabled');

  const effectiveNetwork = selectedNetwork === 'same' ? parentNetwork : selectedNetwork;
  const effectiveSecurity = selectedSecurity === 'same' ? parentSecurity : selectedSecurity;
  const title = remark.trim() || destination.trim()
    || `${t('pages.inbounds.form.subscriptionProfile')} ${displayIndex}`;
  const [profileCollapsed, setProfileCollapsed] = useState(true);

  useEffect(() => {
    if (enabled === undefined) form.setFieldValue([...base, 'enabled'], true);
    if (!form.getFieldValue([...base, 'network'])) {
      form.setFieldValue([...base, 'network'], 'same');
    }
    if (!form.getFieldValue([...base, 'security'])) {
      const migratedSecurity = legacyForceTls !== 'same' ? legacyForceTls : 'same';
      form.setFieldValue([...base, 'security'], migratedSecurity);
    }
  }, [base, enabled, form, legacyForceTls]);

  useEffect(() => {
    const security = form.getFieldValue([...base, 'security']);
    if (security !== 'tls') return;
    if (form.getFieldValue([...base, 'tlsSettings'])) return;

    const migrated = SubscriptionProfileTlsSettingsSchema.parse({
      serverName: form.getFieldValue([...base, 'sni']) ?? '',
      alpn: form.getFieldValue([...base, 'alpn']) ?? [],
      settings: {
        fingerprint: form.getFieldValue([...base, 'fingerprint']) || 'chrome',
        echConfigList: form.getFieldValue([...base, 'echConfigList']) ?? '',
        pinnedPeerCertSha256:
          form.getFieldValue([...base, 'pinnedPeerCertSha256']) ?? [],
          verifyPeerCertByName:
            form.getFieldValue(
              [...base, 'verifyPeerCertByName'],
            ) ?? '',
        allowInsecure: form.getFieldValue([...base, 'allowInsecure']) ?? false,
      },
    });
    form.setFieldValue([...base, 'tlsSettings'], migrated);
  }, [base, form, selectedSecurity]);

  const onNetworkChange = (network: string) => {
    if (network === 'same') return;
    const key = transportSettingsKey(network);
    if (!key || form.getFieldValue([...base, key])) return;
    form.setFieldValue([...base, key], transportDefaults(network));
  };

  const onSecurityChange = (security: string) => {
    form.setFieldValue(
      [...base, 'forceTls'],
      security === 'tls' || security === 'none' ? security : 'same',
    );
    if (security === 'tls' && !form.getFieldValue([...base, 'tlsSettings'])) {
      form.setFieldValue(
        [...base, 'tlsSettings'],
        SubscriptionProfileTlsSettingsSchema.parse({}),
      );
    }
    if (security === 'reality' && !form.getFieldValue([...base, 'realitySettings'])) {
      form.setFieldValue(
        [...base, 'realitySettings'],
        SubscriptionProfileRealitySettingsSchema.parse({}),
      );
    }
  };

  const generateRandomPin = () => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hash = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const path = [...base, 'tlsSettings', 'settings', 'pinnedPeerCertSha256'];
    const current = (form.getFieldValue(path) as string[] | undefined) ?? [];
    form.setFieldValue(path, [...current, hash]);
  };

  return (
    <div className={`ext-proxy-card${enabled === false ? ' ext-proxy-card--disabled' : ''}${profileCollapsed ? ' ext-proxy-card--collapsed' : ''}`}>
      <div className="ext-proxy-card__head">
        <div className="ext-proxy-card__identity">
          <Form.Item name={[fieldName, 'enabled']} valuePropName="checked" noStyle>
            <Switch size="small" />
          </Form.Item>
          <span className="ext-proxy-card__title">{title}</span>
          <Tag className="ext-proxy-card__summary">{effectiveNetwork.toUpperCase()}</Tag>
          <Tag className="ext-proxy-card__summary">{effectiveSecurity.toUpperCase()}</Tag>
          <Tag>{protocol ? protocol.toUpperCase() : '-'}</Tag>
        </div>

        <Space className="ext-proxy-card__actions" size={2}>
          <Tooltip title={profileCollapsed ? 'Expand profile' : 'Collapse profile'}>
            <Button
              size="small"
              type="text"
              icon={profileCollapsed ? <RightOutlined /> : <DownOutlined />}
              onClick={() => setProfileCollapsed((value) => !value)}
            />
          </Tooltip>
          <Tooltip title={t('pages.inbounds.form.moveProfileUp')}>
            <Button
              size="small"
              type="text"
              icon={<ArrowUpOutlined />}
              disabled={displayIndex === 1}
              onClick={onMoveUp}
            />
          </Tooltip>
          <Tooltip title={t('pages.inbounds.form.moveProfileDown')}>
            <Button
              size="small"
              type="text"
              icon={<ArrowDownOutlined />}
              disabled={displayIndex === totalProfiles}
              onClick={onMoveDown}
            />
          </Tooltip>
          <Tooltip title={t('pages.inbounds.form.duplicateProfile')}>
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={onDuplicate} />
          </Tooltip>
          <Tooltip title={t('delete')}>
            <Button
              size="small"
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={onRemove}
            />
          </Tooltip>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        title={t('pages.inbounds.form.subscriptionProfileInheritance', {
          protocol: protocol.toUpperCase(),
        })}
      />

      <div className="ext-proxy-grid ext-proxy-grid--common">
        <Field label={t('pages.inbounds.form.profileName')}>
          <Form.Item name={[fieldName, 'remark']} noStyle>
            <Input placeholder={`${t('pages.inbounds.form.subscriptionProfile')} ${displayIndex}`} />
          </Form.Item>
        </Field>
        <Field
          label={t('pages.inbounds.address')}
          hint={t('pages.inbounds.form.blankUsesInboundAddress')}
        >
          <Form.Item name={[fieldName, 'dest']} noStyle>
            <Input placeholder={t('pages.inbounds.address')} />
          </Form.Item>
        </Field>
        <Field label={t('pages.inbounds.port')}>
          <Form.Item name={[fieldName, 'port']} noStyle>
            <InputNumber style={{ width: '100%' }} min={1} max={65535} />
          </Form.Item>
        </Field>
      </div>

      <div className="ext-proxy-grid ext-proxy-grid--selectors">
        <Field label={t('pages.inbounds.form.profileTransport')}>
          <Form.Item name={[fieldName, 'network']} noStyle>
            <Select
              style={{ width: '100%' }}
              onChange={onNetworkChange}
              options={[
                {
                  value: 'same',
                  label: t('pages.inbounds.form.sameAsInboundValue', {
                    value: parentNetwork.toUpperCase(),
                  }),
                },
                { value: 'tcp', label: 'TCP / RAW' },
                { value: 'ws', label: 'WebSocket' },
                { value: 'grpc', label: 'gRPC' },
                { value: 'httpupgrade', label: 'HTTP Upgrade' },
                { value: 'xhttp', label: 'XHTTP' },
                { value: 'kcp', label: 'mKCP' },
              ]}
            />
          </Form.Item>
        </Field>

        <Field label={t('security')}>
          <Form.Item name={[fieldName, 'security']} noStyle>
            <Select
              style={{ width: '100%' }}
              onChange={onSecurityChange}
              options={[
                {
                  value: 'same',
                  label: t('pages.inbounds.form.sameAsInboundValue', {
                    value: parentSecurity.toUpperCase(),
                  }),
                },
                { value: 'none', label: t('none') },
                {
                  value: 'tls',
                  label: 'TLS',
                  disabled: !canEnableTls({
                    protocol,
                    streamSettings: { network: effectiveNetwork },
                  }),
                },
                {
                  value: 'reality',
                  label: 'REALITY',
                  disabled: !canEnableReality({
                    protocol,
                    streamSettings: { network: effectiveNetwork },
                  }),
                },
              ]}
            />
          </Form.Item>
        </Field>
      </div>

      <details className="ext-proxy-section">
        <summary>{t('pages.inbounds.form.profileTransportSettings')}</summary>
        <div className="ext-proxy-section__body">
          {selectedNetwork === 'same' ? (
            <Alert
              type="success"
              showIcon
              title={t('pages.inbounds.form.profileUsesInboundTransport', {
                network: parentNetwork.toUpperCase(),
              })}
            />
          ) : (
            <TransportSettingsFields
              fieldName={fieldName}
              absoluteBase={[...base]}
              network={effectiveNetwork}
              form={form}
            />
          )}
        </div>
      </details>

      <details className="ext-proxy-section">
        <summary>{t('pages.inbounds.form.profileSecuritySettings')}</summary>
        <div className="ext-proxy-section__body">
          {selectedSecurity === 'same' ? (
            <Alert
              type="success"
              showIcon
              title={t('pages.inbounds.form.profileUsesInboundSecurity', {
                security: parentSecurity.toUpperCase(),
              })}
            />
          ) : (
            <SecuritySettingsFields
              fieldName={fieldName}
              absoluteBase={[...base]}
              security={effectiveSecurity}
              form={form}
              generateRandomPin={generateRandomPin}
            />
          )}
        </div>
      </details>

      <details className="ext-proxy-section">
        <summary>{t('pages.inbounds.form.profileAdvancedSettings')}</summary>
        <div className="ext-proxy-section__body">
          <Field label={t('pages.inbounds.form.finalMask')}>
            <Switch
              checked={finalMask != null}
              onChange={(checked) => {
                form.setFieldValue([...base, 'finalmask'], checked ? {} : undefined);
              }}
            />
          </Field>
          {finalMask != null && (
            <FinalMaskForm
              name={[...base, 'finalmask']}
              network={effectiveNetwork}
              protocol={protocol}
              form={form}
            />
          )}

          <Field
            label={t('pages.inbounds.form.profileMuxMode')}
            hint={t('pages.inbounds.form.profileMuxHint')}
          >
            <Select
              value={muxMode}
              onChange={(mode) => {
                if (mode === 'same') {
                  form.setFieldValue([...base, 'mux'], undefined);
                  return;
                }
                if (mode === 'disabled') {
                  form.setFieldValue([...base, 'mux'], { enabled: false });
                  return;
                }
                form.setFieldValue(
                  [...base, 'mux'],
                  SubscriptionProfileMuxSchema.parse({ enabled: true }),
                );
              }}
              options={[
                { value: 'same', label: t('pages.inbounds.form.profileMuxInherit') },
                { value: 'enabled', label: t('pages.inbounds.form.profileMuxEnabled') },
                { value: 'disabled', label: t('pages.inbounds.form.profileMuxDisabled') },
              ]}
            />
          </Field>

          {muxMode === 'enabled' && (
            <div className="ext-proxy-grid ext-proxy-grid--three">
              <Field label={t('pages.xray.outboundForm.concurrency')}>
                <Form.Item name={[fieldName, 'mux', 'concurrency']} noStyle>
                  <InputNumber min={-1} style={{ width: '100%' }} />
                </Form.Item>
              </Field>
              <Field label={t('pages.xray.outboundForm.xudpConcurrency')}>
                <Form.Item name={[fieldName, 'mux', 'xudpConcurrency']} noStyle>
                  <InputNumber min={-1} style={{ width: '100%' }} />
                </Form.Item>
              </Field>
              <Field label={t('pages.inbounds.form.xudpProxyUDP443')}>
                <Form.Item name={[fieldName, 'mux', 'xudpProxyUDP443']} noStyle>
                  <Select
                    options={['reject', 'allow', 'skip'].map((value) => ({ value, label: value }))}
                  />
                </Form.Item>
              </Field>
            </div>
          )}
            <ClientSockoptForm
              value={sockopt ? JSON.stringify(sockopt) : ''}
              onChange={(next) => {
                if (!next) {
                  form.setFieldValue(
                    [...base, 'sockopt'],
                    undefined,
                  );
                  return;
                }

                try {
                  form.setFieldValue(
                    [...base, 'sockopt'],
                    JSON.parse(next) as Record<string, unknown>,
                  );
                } catch {
                  // The isolated adapter emits valid JSON.
                }
              }}
            />

            <div className="ext-proxy-grid ext-proxy-grid--three">
              <Field
                label={t('pages.hosts.fields.excludeFromSubTypes')}
                hint={t('pages.hosts.hints.excludeFromSubTypes')}
              >
                <Form.Item name={[fieldName, 'excludeFromSubTypes']} noStyle>
                  <Select
                    mode="multiple"
                    allowClear
                    options={[
                      { value: 'raw', label: 'Raw' },
                      { value: 'json', label: 'JSON' },
                      { value: 'clash', label: 'Clash / Mihomo' },
                    ]}
                  />
                </Form.Item>
              </Field>

              <Field
                label={t('pages.hosts.fields.vlessRoute')}
                hint={t('pages.hosts.hints.vlessRoute')}
              >
                <Form.Item name={[fieldName, 'vlessRoute']} noStyle>
                  <Input placeholder="53,443,1000-2000" />
                </Form.Item>
              </Field>

              <Field label={t('pages.hosts.fields.mihomoIpVersion')}>
                <Form.Item name={[fieldName, 'mihomoIpVersion']} noStyle>
                  <Select
                    allowClear
                    placeholder="Auto"
                    options={[
                      { value: 'dual', label: 'dual' },
                      { value: 'ipv4', label: 'ipv4' },
                      { value: 'ipv6', label: 'ipv6' },
                      { value: 'ipv4-prefer', label: 'ipv4-prefer' },
                      { value: 'ipv6-prefer', label: 'ipv6-prefer' },
                    ]}
                  />
                </Form.Item>
              </Field>
            </div>

            <div className="ext-proxy-grid ext-proxy-grid--two">
              <Field label={t('pages.hosts.fields.mihomoX25519')}>
                <Form.Item name={[fieldName, 'mihomoX25519']} valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </Field>

              <Field label={t('pages.hosts.fields.shuffleHost')}>
                <Form.Item name={[fieldName, 'shuffleHost']} valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </Field>
            </div>


        </div>
      </details>
    </div>
  );
}

function TransportSettingsFields({
  fieldName,
  absoluteBase,
  network,
  form,
}: {
  fieldName: number;
  absoluteBase: (string | number)[];
  network: string;
  form: FormInstance;
}) {
  const { t } = useTranslation();
  const tcpHeaderType = Form.useWatch(
    [...absoluteBase, 'tcpSettings', 'header', 'type'],
    form,
  ) as string | undefined;
  const xhttpMode = Form.useWatch(
    [...absoluteBase, 'xhttpSettings', 'mode'],
    form,
  ) as string | undefined;
  const xPaddingObfsMode = Form.useWatch(
    [...absoluteBase, 'xhttpSettings', 'xPaddingObfsMode'],
    form,
  ) ?? false;
  const sessionPlacement = Form.useWatch(
    [...absoluteBase, 'xhttpSettings', 'sessionPlacement'],
    form,
  ) as string | undefined;
  const seqPlacement = Form.useWatch(
    [...absoluteBase, 'xhttpSettings', 'seqPlacement'],
    form,
  ) as string | undefined;
  const uplinkPlacement = Form.useWatch(
    [...absoluteBase, 'xhttpSettings', 'uplinkDataPlacement'],
    form,
  ) as string | undefined;
  const xmux = Form.useWatch(
    [...absoluteBase, 'xhttpSettings', 'xmux'],
    { form, preserve: true },
  );

  if (network === 'tcp') {
    return (
      <>
        <div className="ext-proxy-grid ext-proxy-grid--two">
          <Field label={`HTTP ${t('camouflage')}`}>
            <Form.Item name={[fieldName, 'tcpSettings', 'header', 'type']} noStyle>
              <Select
                options={[
                  { value: 'none', label: t('none') },
                  { value: 'http', label: 'HTTP/1.1' },
                ]}
              />
            </Form.Item>
          </Field>
        </div>
        {tcpHeaderType === 'http' && (
          <>
            <div className="ext-proxy-grid ext-proxy-grid--three">
              <Field label={t('pages.inbounds.form.requestVersion')}>
                <Form.Item name={[fieldName, 'tcpSettings', 'header', 'request', 'version']} noStyle>
                  <Input placeholder="1.1" />
                </Form.Item>
              </Field>
              <Field label={t('pages.inbounds.form.requestMethod')}>
                <Form.Item name={[fieldName, 'tcpSettings', 'header', 'request', 'method']} noStyle>
                  <Input placeholder="GET" />
                </Form.Item>
              </Field>
              <Field label={t('pages.inbounds.form.requestPath')}>
                <Form.Item name={[fieldName, 'tcpSettings', 'header', 'request', 'path']} noStyle>
                  <Select mode="tags" tokenSeparators={[',']} placeholder="/" />
                </Form.Item>
              </Field>
            </div>
            <Field label={t('pages.inbounds.form.requestHeaders')}>
              <Form.Item name={[fieldName, 'tcpSettings', 'header', 'request', 'headers']} noStyle>
                <HeaderMapEditor mode="v2" />
              </Form.Item>
            </Field>
          </>
        )}
      </>
    );
  }

  if (network === 'ws') {
    return (
      <>
        <div className="ext-proxy-grid ext-proxy-grid--three">
          <Field label={t('host')}>
            <Form.Item name={[fieldName, 'wsSettings', 'host']} noStyle><Input /></Form.Item>
          </Field>
          <Field label={t('path')}>
            <Form.Item name={[fieldName, 'wsSettings', 'path']} noStyle><Input /></Form.Item>
          </Field>
          <Field label={t('pages.inbounds.form.heartbeatPeriod')}>
            <Form.Item name={[fieldName, 'wsSettings', 'heartbeatPeriod']} noStyle>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Field>
        </div>
        <Field label={t('pages.inbounds.form.headers')}>
          <Form.Item name={[fieldName, 'wsSettings', 'headers']} noStyle>
            <HeaderMapEditor mode="v1" />
          </Form.Item>
        </Field>
      </>
    );
  }

  if (network === 'grpc') {
    return (
      <div className="ext-proxy-grid ext-proxy-grid--three">
        <Field label={t('pages.inbounds.form.serviceName')}>
          <Form.Item name={[fieldName, 'grpcSettings', 'serviceName']} noStyle><Input /></Form.Item>
        </Field>
        <Field label={t('pages.inbounds.form.authority')}>
          <Form.Item name={[fieldName, 'grpcSettings', 'authority']} noStyle><Input /></Form.Item>
        </Field>
        <Field label={t('pages.inbounds.form.multiMode')}>
          <Form.Item name={[fieldName, 'grpcSettings', 'multiMode']} valuePropName="checked" noStyle>
            <Switch />
          </Form.Item>
        </Field>
      </div>
    );
  }

  if (network === 'httpupgrade') {
    return (
      <>
        <div className="ext-proxy-grid ext-proxy-grid--two">
          <Field label={t('host')}>
            <Form.Item name={[fieldName, 'httpupgradeSettings', 'host']} noStyle><Input /></Form.Item>
          </Field>
          <Field label={t('path')}>
            <Form.Item name={[fieldName, 'httpupgradeSettings', 'path']} noStyle><Input /></Form.Item>
          </Field>
        </div>
        <Field label={t('pages.inbounds.form.headers')}>
          <Form.Item name={[fieldName, 'httpupgradeSettings', 'headers']} noStyle>
            <HeaderMapEditor mode="v1" />
          </Form.Item>
        </Field>
      </>
    );
  }

  if (network === 'kcp') {
    return (
      <div className="ext-proxy-grid ext-proxy-grid--three">
        <Field label="MTU">
          <Form.Item name={[fieldName, 'kcpSettings', 'mtu']} noStyle>
            <InputNumber min={576} max={1460} style={{ width: '100%' }} />
          </Form.Item>
        </Field>
        <Field label={t('pages.inbounds.form.ttiMs')}>
          <Form.Item name={[fieldName, 'kcpSettings', 'tti']} noStyle>
            <InputNumber min={10} max={100} style={{ width: '100%' }} />
          </Form.Item>
        </Field>
        <Field label={t('pages.inbounds.form.uplinkMbps')}>
          <Form.Item name={[fieldName, 'kcpSettings', 'uplinkCapacity']} noStyle>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Field>
        <Field label={t('pages.inbounds.form.downlinkMbps')}>
          <Form.Item name={[fieldName, 'kcpSettings', 'downlinkCapacity']} noStyle>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Field>
        <Field label={t('pages.inbounds.form.cwndMultiplier')}>
          <Form.Item name={[fieldName, 'kcpSettings', 'cwndMultiplier']} noStyle>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Field>
        <Field label={t('pages.inbounds.form.maxSendingWindow')}>
          <Form.Item name={[fieldName, 'kcpSettings', 'maxSendingWindow']} noStyle>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Field>
      </div>
    );
  }

  if (network === 'xhttp') {
    return (
      <>
        <div className="ext-proxy-grid ext-proxy-grid--three">
          <Field label={t('host')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'host']} noStyle><Input /></Form.Item>
          </Field>
          <Field label={t('path')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'path']} noStyle><Input /></Form.Item>
          </Field>
          <Field label={t('pages.inbounds.info.mode')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'mode']} noStyle>
              <Select options={['auto', 'packet-up', 'stream-up', 'stream-one'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Field>
          <Field label={t('pages.inbounds.form.paddingBytes')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'xPaddingBytes']} noStyle><Input /></Form.Item>
          </Field>
          <Field label={t('pages.inbounds.form.uplinkHttpMethod')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'uplinkHTTPMethod']} noStyle>
              <Select
                options={[
                  { value: '', label: 'Default (POST)' },
                  { value: 'POST', label: 'POST' },
                  { value: 'PUT', label: 'PUT' },
                  { value: 'GET', label: 'GET', disabled: xhttpMode !== 'packet-up' },
                ]}
              />
            </Form.Item>
          </Field>
          <Field label={t('pages.xray.outboundForm.minUploadInterval')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'scMinPostsIntervalMs']} noStyle><Input /></Form.Item>
          </Field>
          <Field label={t('pages.xray.outboundForm.uplinkChunkSize')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'uplinkChunkSize']} noStyle>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Field>
          <Field label={t('pages.xray.outboundForm.noGrpcHeader')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'noGRPCHeader']} valuePropName="checked" noStyle>
              <Switch />
            </Form.Item>
          </Field>
        </div>

        <Field label={t('pages.inbounds.form.headers')}>
          <Form.Item name={[fieldName, 'xhttpSettings', 'headers']} noStyle>
            <HeaderMapEditor mode="v1" />
          </Form.Item>
        </Field>

        <div className="ext-proxy-grid ext-proxy-grid--three">
          <Field label={t('pages.inbounds.form.paddingObfsMode')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'xPaddingObfsMode']} valuePropName="checked" noStyle>
              <Switch />
            </Form.Item>
          </Field>
          {xPaddingObfsMode && (
            <>
              <Field label={t('pages.inbounds.form.paddingKey')}>
                <Form.Item name={[fieldName, 'xhttpSettings', 'xPaddingKey']} noStyle><Input /></Form.Item>
              </Field>
              <Field label={t('pages.inbounds.form.paddingHeader')}>
                <Form.Item name={[fieldName, 'xhttpSettings', 'xPaddingHeader']} noStyle><Input /></Form.Item>
              </Field>
            </>
          )}
          <Field label={t('pages.inbounds.form.sessionPlacement')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'sessionPlacement']} noStyle>
              <Select options={['', 'path', 'header', 'cookie', 'query'].map((v) => ({ value: v, label: v || 'Default' }))} />
            </Form.Item>
          </Field>
          {sessionPlacement && sessionPlacement !== 'path' && (
            <Field label={t('pages.inbounds.form.sessionKey')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'sessionKey']} noStyle><Input /></Form.Item>
            </Field>
          )}
          <Field label={t('pages.inbounds.form.sequencePlacement')}>
            <Form.Item name={[fieldName, 'xhttpSettings', 'seqPlacement']} noStyle>
              <Select options={['', 'path', 'header', 'cookie', 'query'].map((v) => ({ value: v, label: v || 'Default' }))} />
            </Form.Item>
          </Field>
          {seqPlacement && seqPlacement !== 'path' && (
            <Field label={t('pages.inbounds.form.sequenceKey')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'seqKey']} noStyle><Input /></Form.Item>
            </Field>
          )}
          {xhttpMode === 'packet-up' && (
            <>
              <Field label={t('pages.inbounds.form.uplinkDataPlacement')}>
                <Form.Item name={[fieldName, 'xhttpSettings', 'uplinkDataPlacement']} noStyle>
                  <Select options={['', 'body', 'header', 'cookie', 'query'].map((v) => ({ value: v, label: v || 'Default' }))} />
                </Form.Item>
              </Field>
              {uplinkPlacement && uplinkPlacement !== 'body' && (
                <Field label={t('pages.inbounds.form.uplinkDataKey')}>
                  <Form.Item name={[fieldName, 'xhttpSettings', 'uplinkDataKey']} noStyle><Input /></Form.Item>
                </Field>
              )}
            </>
          )}
        </div>

        <Field label="XMUX">
          <Switch
            checked={xmux != null}
            onChange={(checked) => {
              form.setFieldValue(
                [...absoluteBase, 'xhttpSettings', 'xmux'],
                checked ? XHttpXmuxSchema.parse({}) : undefined,
              );
            }}
          />
        </Field>
        {xmux != null && (
          <div className="ext-proxy-grid ext-proxy-grid--three">
            <Field label={t('pages.xray.outboundForm.maxConcurrency')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'xmux', 'maxConcurrency']} noStyle><Input /></Form.Item>
            </Field>
            <Field label={t('pages.xray.outboundForm.maxConnections')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'xmux', 'maxConnections']} noStyle><Input /></Form.Item>
            </Field>
            <Field label={t('pages.xray.outboundForm.maxReuseTimes')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'xmux', 'cMaxReuseTimes']} noStyle><Input /></Form.Item>
            </Field>
            <Field label={t('pages.xray.outboundForm.maxRequestTimes')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'xmux', 'hMaxRequestTimes']} noStyle><Input /></Form.Item>
            </Field>
            <Field label={t('pages.xray.outboundForm.maxReusableSecs')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'xmux', 'hMaxReusableSecs']} noStyle><Input /></Form.Item>
            </Field>
            <Field label={t('pages.xray.outboundForm.keepAlivePeriod')}>
              <Form.Item name={[fieldName, 'xhttpSettings', 'xmux', 'hKeepAlivePeriod']} noStyle>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Field>
          </div>
        )}
      </>
    );
  }

  return <Alert type="warning" showIcon title={t('pages.inbounds.form.unsupportedProfileTransport')} />;
}

function SecuritySettingsFields({
  fieldName,
  absoluteBase,
  security,
  form,
  generateRandomPin,
}: {
  fieldName: number;
  absoluteBase: (string | number)[];
  security: string;
  form: FormInstance;
  generateRandomPin: () => void;
}) {
  const { t } = useTranslation();
  const overrideSniFromAddress = Form.useWatch(
    [...absoluteBase, 'overrideSniFromAddress'],
    form,
  ) === true;
  const keepSniBlank = Form.useWatch(
    [...absoluteBase, 'keepSniBlank'],
    form,
  ) === true;

  if (security === 'none') {
    return <Alert type="info" showIcon title={t('pages.inbounds.form.profileSecurityDisabled')} />;
  }

  if (security === 'tls') {
    return (
      <>
        <div className="ext-proxy-grid ext-proxy-grid--three">
          <Field label="SNI">
              <Form.Item name={[fieldName, 'tlsSettings', 'serverName']} noStyle><Input disabled={overrideSniFromAddress || keepSniBlank} /></Form.Item>
          </Field>
            <Field label={t('pages.hosts.fields.overrideSniFromAddress')}>
              <Form.Item
                name={[fieldName, 'overrideSniFromAddress']}
                valuePropName="checked"
                noStyle
              >
                <Switch
                  onChange={(checked) => {
                    if (checked) {
                      form.setFieldValue(
                        [...absoluteBase, 'keepSniBlank'],
                        false,
                      );
                    }
                  }}
                />
              </Form.Item>
            </Field>
            <Field label={t('pages.hosts.fields.keepSniBlank')}>
              <Form.Item
                name={[fieldName, 'keepSniBlank']}
                valuePropName="checked"
                noStyle
              >
                <Switch
                  onChange={(checked) => {
                    if (checked) {
                      form.setFieldValue(
                        [...absoluteBase, 'overrideSniFromAddress'],
                        false,
                      );
                    }
                  }}
                />
              </Form.Item>
            </Field>
          <Field label={t('pages.inbounds.form.fingerprint')}>
            <Form.Item name={[fieldName, 'tlsSettings', 'settings', 'fingerprint']} noStyle>
              <Select options={Object.values(UTLS_FINGERPRINT).map((value) => ({ value, label: value }))} />
            </Form.Item>
          </Field>
          <Field label="ALPN">
            <Form.Item name={[fieldName, 'tlsSettings', 'alpn']} noStyle>
              <Select
                mode="multiple"
                options={Object.values(ALPN_OPTION).map((value) => ({ value, label: value }))}
              />
            </Form.Item>
          </Field>
          <Field label={t('pages.inbounds.form.allowInsecure')}>
            <Form.Item
              name={[fieldName, 'tlsSettings', 'settings', 'allowInsecure']}
              valuePropName="checked"
              noStyle
            >
              <Switch />
            </Form.Item>
          </Field>
          <Field label={t('pages.inbounds.form.echConfig')}>
            <Form.Item name={[fieldName, 'tlsSettings', 'settings', 'echConfigList']} noStyle><Input /></Form.Item>
          </Field>
            <Field
              label={t('pages.inbounds.form.verifyPeerCertByName')}
              hint={t('pages.inbounds.form.verifyPeerCertByNameTip')}
            >
              <Form.Item
                name={[
                  fieldName,
                  'tlsSettings',
                  'settings',
                  'verifyPeerCertByName',
                ]}
                noStyle
              >
                <Input />
              </Form.Item>
            </Field>
        </div>
        <Field label={t('pages.inbounds.form.pinnedPeerCertSha256')}>
          <Space.Compact block>
            <Form.Item
              name={[fieldName, 'tlsSettings', 'settings', 'pinnedPeerCertSha256']}
              noStyle
            >
              <Select
                mode="tags"
                tokenSeparators={[',', ' ']}
                placeholder={t('pages.inbounds.form.pinnedPeerCertSha256Placeholder')}
                style={{ width: 'calc(100% - 32px)' }}
              />
            </Form.Item>
            <Button
              icon={<ReloadOutlined />}
              onClick={generateRandomPin}
              title={t('pages.inbounds.form.generateRandomPin')}
            />
          </Space.Compact>
        </Field>
      </>
    );
  }

  if (security === 'reality') {
    return (
      <>
        <div className="ext-proxy-grid ext-proxy-grid--three">
          <Field label="SNI">
            <Form.Item name={[fieldName, 'realitySettings', 'serverNames']} noStyle>
              <Select
                mode="tags"
                tokenSeparators={[',', ' ']}
                onChange={(values: string[]) => {
                  form.setFieldValue(
                    [...absoluteBase, 'realitySettings', 'settings', 'serverName'],
                    values[0] ?? '',
                  );
                }}
              />
            </Form.Item>
          </Field>
          <Field label={t('pages.inbounds.form.fingerprint')}>
            <Form.Item name={[fieldName, 'realitySettings', 'settings', 'fingerprint']} noStyle>
              <Select options={Object.values(UTLS_FINGERPRINT).map((value) => ({ value, label: value }))} />
            </Form.Item>
          </Field>
          <Field label={t('pages.inbounds.form.shortIds')}>
            <Form.Item name={[fieldName, 'realitySettings', 'shortIds']} noStyle>
              <Select mode="tags" tokenSeparators={[',', ' ']} />
            </Form.Item>
          </Field>
        </div>
        <Field label={t('pages.inbounds.publicKey')}>
          <Form.Item name={[fieldName, 'realitySettings', 'settings', 'publicKey']} noStyle><Input /></Form.Item>
        </Field>
        <div className="ext-proxy-grid ext-proxy-grid--two">
          <Field label="SpiderX">
            <Form.Item name={[fieldName, 'realitySettings', 'settings', 'spiderX']} noStyle><Input /></Form.Item>
          </Field>
          <Field label="ML-DSA-65 Verify">
            <Form.Item name={[fieldName, 'realitySettings', 'settings', 'mldsa65Verify']} noStyle><Input /></Form.Item>
          </Field>
        </div>
      </>
    );
  }

  return <Alert type="warning" showIcon title={t('pages.inbounds.form.unsupportedProfileSecurity')} />;
}
