import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormContext } from 'react-hook-form';
import { Button, Form, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import {
  createSubscriptionProfileDraft,
  normalizeSubscriptionPort,
  planDefaultSubscriptionPortSync,
  type DefaultSubscriptionPortSyncState,
} from '@/lib/xray/subscription-profile';

import SubscriptionProfileEditor from './subscription-profile-editor';
import './external-proxy.css';

function cloneProfile<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default function ExternalProxyForm() {
  const { t } = useTranslation();
  const form = Form.useFormInstance();
  const { setValue: setRHFValue } = useFormContext();
  const watchedParentPort = Form.useWatch('port', form);
  const parentPort = watchedParentPort ?? 443;
  const watchedProfiles = Form.useWatch(
    ['streamSettings', 'externalProxy'],
    form,
  ) as Array<{ port?: unknown }> | undefined;
  const watchedDefaultProfilePort = watchedProfiles?.[0]?.port;
  const portSyncStateRef = useRef<DefaultSubscriptionPortSyncState | null>(null);

  useEffect(() => {
    const current = {
      inboundPort: normalizeSubscriptionPort(watchedParentPort),
      profilePort: normalizeSubscriptionPort(watchedDefaultProfilePort),
    };
    const plan = planDefaultSubscriptionPortSync(
      portSyncStateRef.current,
      current,
    );

    portSyncStateRef.current = plan.state;

    if (
      plan.setInboundPort !== undefined
      && plan.setInboundPort !== current.inboundPort
    ) {
      form.setFieldValue('port', plan.setInboundPort);
      setRHFValue(
        'port',
        plan.setInboundPort,
        { shouldDirty: true },
      );
    }

    if (
      plan.setProfilePort !== undefined
      && plan.setProfilePort !== current.profilePort
    ) {
      form.setFieldValue(
        ['streamSettings', 'externalProxy', 0, 'port'],
        plan.setProfilePort,
      );
    }
  }, [
    form,
    watchedDefaultProfilePort,
    watchedParentPort,
  ]);

  const toggleProfiles = (on: boolean) => {
    const profiles = on
      ? [createSubscriptionProfileDraft(parentPort)]
      : [];

    form.setFieldValue(
      ['streamSettings', 'externalProxy'],
      profiles,
    );

    setRHFValue(
      'streamSettings.externalProxy',
      profiles,
      {
        shouldDirty: true,
        shouldTouch: true,
      },
    );
  };

  return (
    <Form.Item
      noStyle
      shouldUpdate={(prev, curr) => {
        const a = (prev.streamSettings as { externalProxy?: unknown[] } | undefined)?.externalProxy;
        const b = (curr.streamSettings as { externalProxy?: unknown[] } | undefined)?.externalProxy;
        return (Array.isArray(a) ? a.length : 0) !== (Array.isArray(b) ? b.length : 0);
      }}
    >
      {({ getFieldValue }) => {
        const profiles = getFieldValue(['streamSettings', 'externalProxy']);
        const enabled = Array.isArray(profiles) && profiles.length > 0;

        return (
          <>
            <Form.Item
              label={t('pages.inbounds.form.subscriptionProfiles')}
            >
              <Switch checked={enabled} onChange={toggleProfiles} />
            </Form.Item>

            {enabled && (
              <Form.Item wrapperCol={{ span: 24 }}>
                <Form.List name={['streamSettings', 'externalProxy']}>
                  {(fields, { add, remove, move }) => (
                    <>
                      <div className="ext-proxy-list">
                        {fields.map((field, index) => (
                          <SubscriptionProfileEditor
                            key={field.key}
                            fieldName={field.name}
                            displayIndex={index + 1}
                            totalProfiles={fields.length}
                            form={form}
                            onRemove={() => remove(field.name)}
                            onDuplicate={() => {
                              const current = form.getFieldValue([
                                'streamSettings', 'externalProxy', field.name,
                              ]);
                              const duplicate = cloneProfile(current);
                              duplicate.remark = duplicate.remark
                                ? `${duplicate.remark} (${t('copy')})`
                                : `${t('pages.inbounds.form.subscriptionProfile')} ${index + 2}`;
                              add(duplicate, field.name + 1);
                            }}
                            onMoveUp={() => move(field.name, field.name - 1)}
                            onMoveDown={() => move(field.name, field.name + 1)}
                          />
                        ))}
                      </div>

                      <Button
                        className="ext-proxy-add"
                        block
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => add(createSubscriptionProfileDraft(parentPort))}
                      >
                        {t('pages.inbounds.form.addSubscriptionProfile')}
                      </Button>
                    </>
                  )}
                </Form.List>
              </Form.Item>
            )}
          </>
        );
      }}
    </Form.Item>
  );
}
