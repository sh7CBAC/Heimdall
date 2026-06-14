import { useTranslation } from 'react-i18next';
import { Button, Form, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import { createSubscriptionProfileDraft } from '@/lib/xray/subscription-profile';

import SubscriptionProfileEditor from './subscription-profile-editor';
import './external-proxy.css';

function cloneProfile<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default function ExternalProxyForm() {
  const { t } = useTranslation();
  const form = Form.useFormInstance();
  const parentPort = Form.useWatch('port', form) ?? 443;

  const defaultAddress = typeof window !== 'undefined' ? window.location.hostname : '';

  const toggleProfiles = (on: boolean) => {
    form.setFieldValue(
      ['streamSettings', 'externalProxy'],
      on ? [createSubscriptionProfileDraft(defaultAddress, parentPort)] : [],
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
              extra={t('pages.inbounds.form.subscriptionProfilesHint')}
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
                        onClick={() => add(createSubscriptionProfileDraft(defaultAddress, parentPort))}
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
