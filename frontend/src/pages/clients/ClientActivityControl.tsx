import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Empty,
  Modal,
  Pagination,
  Popconfirm,
  Spin,
  Tag,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { HttpUtil, SizeFormatter } from '@/utils';
import {
  parseClientActivityList,
  parseClientActivityStatus,
  type ClientActivityList,
  type ClientActivityStatus,
} from './clientActivity';
import './ClientActivityControl.css';

const ACTIVITY_PAGE_SIZE = 50;

interface ApiMsg<T = unknown> {
  success?: boolean;
  obj?: T;
  msg?: string;
}

interface ClientActivityControlProps {
  email: string;
  active: boolean;
}

type ActivityAction = 'start' | 'stop' | 'reset';

export default function ClientActivityControl({
  email,
  active,
}: ClientActivityControlProps) {
  const { t } = useTranslation();
  const { isMobile } = useMediaQuery();
  const [messageApi, messageContextHolder] = message.useMessage();

  const [status, setStatus] =
    useState<ClientActivityStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  const [activityOpen, setActivityOpen] = useState(false);
  const [activity, setActivity] =
    useState<ClientActivityList | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');

  const [action, setAction] =
    useState<ActivityAction | null>(null);

  const actionLock = useRef(false);

  const encodedEmail = useMemo(
    () => encodeURIComponent(email),
    [email],
  );

  const loadStatus = useCallback(async () => {
    if (!active || !email) return;

    setStatusLoading(true);
    setStatusError('');

    try {
      const msg = await HttpUtil.get(
        `/panel/api/clients/${encodedEmail}/activity/status`,
        undefined,
        { silent: true },
      ) as ApiMsg;

      if (!msg?.success) {
        throw new Error(
          msg?.msg || 'Failed to load Activity monitoring status.',
        );
      }

      const parsed = parseClientActivityStatus(msg.obj);
      if (!parsed) {
        throw new Error('Invalid Activity status response.');
      }

      setStatus(parsed);
    } catch (error) {
      setStatus(null);
      setStatusError(
        error instanceof Error
          ? error.message
          : 'Failed to load Activity monitoring status.',
      );
    } finally {
      setStatusLoading(false);
    }
  }, [active, email, encodedEmail]);

  const loadActivity = useCallback(async (
    requestedPage: number,
  ) => {
    if (!email) return;

    setActivityLoading(true);
    setActivityError('');

    try {
      const query = new URLSearchParams({
        page: String(Math.max(1, requestedPage)),
        pageSize: String(ACTIVITY_PAGE_SIZE),
      });

      const msg = await HttpUtil.get(
        `/panel/api/clients/${encodedEmail}/activity?${query}`,
        undefined,
        { silent: true },
      ) as ApiMsg;

      if (!msg?.success) {
        throw new Error(
          msg?.msg || 'Failed to load Activity data.',
        );
      }

      const parsed = parseClientActivityList(msg.obj);
      if (!parsed) {
        throw new Error('Invalid Activity list response.');
      }

      setActivity(parsed);

      setStatus((current) => (
        current
          ? {
              ...current,
              enabled: parsed.enabled,
              generation: parsed.generation,
              dataEpoch: parsed.dataEpoch,
            }
          : current
      ));
    } catch (error) {
      setActivityError(
        error instanceof Error
          ? error.message
          : 'Failed to load Activity data.',
      );
    } finally {
      setActivityLoading(false);
    }
  }, [email, encodedEmail]);

  useEffect(() => {
    if (!active) {
      setActivityOpen(false);
      return;
    }

    setStatus(null);
    setStatusError('');
    setActivity(null);
    setActivityError('');

    void loadStatus();
  }, [active, email, loadStatus]);

  useEffect(() => {
    if (!activityOpen) return;
    void loadActivity(1);
  }, [activityOpen, loadActivity]);

  async function runAction(
    requestedAction: ActivityAction,
  ) {
    if (!email || actionLock.current) return;

    actionLock.current = true;
    setAction(requestedAction);

    try {
      const msg = await HttpUtil.post(
        `/panel/api/clients/${encodedEmail}/activity/${requestedAction}`,
        undefined,
        { silent: true },
      ) as ApiMsg;

      if (!msg?.success) {
        throw new Error(
          msg?.msg || `Activity ${requestedAction} failed.`,
        );
      }

      const parsed = parseClientActivityStatus(msg.obj);
      if (!parsed) {
        throw new Error('Invalid Activity action response.');
      }

      setStatus(parsed);
      setStatusError('');

      if (requestedAction === 'start') {
        messageApi.success(
          t('pages.clients.activity.started', {
            defaultValue: 'Activity monitoring started.',
          }),
        );
      }

      if (requestedAction === 'stop') {
        messageApi.success(
          t('pages.clients.activity.stopped', {
            defaultValue:
              'Activity monitoring stopped. Existing history was preserved.',
          }),
        );
      }

      if (requestedAction === 'reset') {
        setActivity(null);
        await loadActivity(1);

        messageApi.success(
          t('pages.clients.activity.resetSuccess', {
            defaultValue: 'Activity data cleared successfully.',
          }),
        );
      }
    } catch (error) {
      messageApi.error(
        error instanceof Error
          ? error.message
          : 'Activity operation failed.',
      );
    } finally {
      actionLock.current = false;
      setAction(null);
    }
  }

  function openActivity() {
    setActivity(null);
    setActivityError('');
    setActivityOpen(true);
  }

  const controlsDisabled = action !== null;

  const statusContent = (() => {
    if (statusLoading) {
      return (
        <span className="client-activity-status-loading">
          <Spin size="small" />
          <span>
            {t('loading', { defaultValue: 'Loading' })}
          </span>
        </span>
      );
    }

    if (statusError) {
      return (
        <div className="client-activity-actions">
          <Tag color="red">
            {t('error', { defaultValue: 'Error' })}
          </Tag>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void loadStatus()}
          >
            {t('retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      );
    }

    if (!status) {
      return <Tag>{t('unknown', { defaultValue: 'Unknown' })}</Tag>;
    }

    if (!status.enabled) {
      return (
        <div className="client-activity-actions">
          <Tag>
            {t('disabled', { defaultValue: 'Disabled' })}
          </Tag>

          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={action === 'start'}
            disabled={controlsDisabled && action !== 'start'}
            onClick={() => void runAction('start')}
          >
            {t('pages.clients.activity.start', {
              defaultValue: 'Start',
            })}
          </Button>
        </div>
      );
    }

    return (
      <div className="client-activity-actions">
        <Tag color="green">
          {t('enabled', { defaultValue: 'Enabled' })}
        </Tag>

        <Button
          size="small"
          icon={<EyeOutlined />}
          disabled={controlsDisabled}
          onClick={openActivity}
        >
          {t('pages.clients.activity.view', {
            defaultValue: 'View Activity',
          })}
        </Button>

        <Popconfirm
          title={t('pages.clients.activity.stopConfirmTitle', {
            defaultValue: 'Stop Activity monitoring?',
          })}
          description={t(
            'pages.clients.activity.stopConfirmDescription',
            {
              defaultValue:
                'New activity will no longer be collected. Existing history will be preserved.',
            },
          )}
          okText={t('stop', { defaultValue: 'Stop' })}
          cancelText={t('cancel', { defaultValue: 'Cancel' })}
          disabled={controlsDisabled}
          onConfirm={() => runAction('stop')}
        >
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            loading={action === 'stop'}
            disabled={controlsDisabled && action !== 'stop'}
          >
            {t('pages.clients.activity.stop', {
              defaultValue: 'Stop',
            })}
          </Button>
        </Popconfirm>
      </div>
    );
  })();

  const activityBody = (() => {
    if (activityLoading && !activity) {
      return (
        <div className="client-activity-centered">
          <Spin />
          <span>
            {t('pages.clients.activity.loading', {
              defaultValue: 'Loading Activity data…',
            })}
          </span>
        </div>
      );
    }

    if (activityError) {
      return (
        <Alert
          type="error"
          showIcon
          message={t('pages.clients.activity.loadFailed', {
            defaultValue: 'Activity data could not be loaded.',
          })}
          description={activityError}
          action={
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={activityLoading}
              onClick={() => void loadActivity(activity?.page || 1)}
            >
              {t('retry', { defaultValue: 'Retry' })}
            </Button>
          }
        />
      );
    }

    if (!activity || activity.items.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('pages.clients.activity.noData', {
            defaultValue:
              'Monitoring is enabled, but no destination activity has been observed yet.',
          })}
        />
      );
    }

    if (isMobile) {
      return (
        <div className="client-activity-card-list">
          {activity.items.map((item) => (
            <Card
              key={`${item.sourceIp}-${item.destination}`}
              size="small"
              className="client-activity-card"
            >
              <div className="client-activity-card-row">
                <span className="client-activity-card-label">
                  {t('pages.clients.activity.destination', {
                    defaultValue: 'Observed Destination',
                  })}
                </span>
                <span
                  className="client-activity-destination"
                  dir="auto"
                >
                  {item.destination}
                </span>
              </div>

              <div className="client-activity-card-row">
                <span className="client-activity-card-label">
                  {t('pages.clients.activity.sourceIp', {
                    defaultValue: 'Source IP',
                  })}
                </span>
                <span
                  className="client-activity-ip"
                  dir="ltr"
                >
                  {item.sourceIp}
                </span>
              </div>

              <div className="client-activity-card-metrics">
                <div>
                  <span className="client-activity-card-label">
                    {t('pages.clients.activity.upload', {
                      defaultValue: 'Upload',
                    })}
                  </span>
                  <strong>
                    {SizeFormatter.sizeFormat(item.uploadBytes)}
                  </strong>
                </div>

                <div>
                  <span className="client-activity-card-label">
                    {t('pages.clients.activity.download', {
                      defaultValue: 'Download',
                    })}
                  </span>
                  <strong>
                    {SizeFormatter.sizeFormat(item.downloadBytes)}
                  </strong>
                </div>
              </div>
            </Card>
          ))}
        </div>
      );
    }

    return (
      <div className="client-activity-table-container">
        <table className="client-activity-table">
          <thead>
            <tr>
              <th>
                {t('pages.clients.activity.destination', {
                  defaultValue: 'Observed Destination',
                })}
              </th>
              <th>
                {t('pages.clients.activity.sourceIp', {
                  defaultValue: 'Source IP',
                })}
              </th>
              <th>
                {t('pages.clients.activity.upload', {
                  defaultValue: 'Upload',
                })}
              </th>
              <th>
                {t('pages.clients.activity.download', {
                  defaultValue: 'Download',
                })}
              </th>
            </tr>
          </thead>

          <tbody>
            {activity.items.map((item) => (
              <tr key={`${item.sourceIp}-${item.destination}`}>
                <td>
                  <span
                    className="client-activity-destination"
                    dir="auto"
                  >
                    {item.destination}
                  </span>
                </td>
                <td>
                  <span
                    className="client-activity-ip"
                    dir="ltr"
                  >
                    {item.sourceIp}
                  </span>
                </td>
                <td>
                  {SizeFormatter.sizeFormat(item.uploadBytes)}
                </td>
                <td>
                  {SizeFormatter.sizeFormat(item.downloadBytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  })();

  return (
    <>
      {messageContextHolder}

      {statusContent}

      <Modal
        open={activityOpen}
        destroyOnHidden
        width={isMobile ? 'calc(100vw - 24px)' : 900}
        title={`${t('pages.clients.activity.title', {
          defaultValue: 'Client Activity',
        })} — ${email}`}
        onCancel={() => setActivityOpen(false)}
        styles={{
          body: {
            maxHeight: 'calc(100vh - 190px)',
            overflowY: 'auto',
            overflowX: 'hidden',
          },
        }}
        footer={
          <div className="client-activity-footer">
            <Popconfirm
              title={t('pages.clients.activity.resetConfirmTitle', {
                defaultValue: 'Clear all Activity data?',
              })}
              description={t(
                'pages.clients.activity.resetConfirmDescription',
                {
                  defaultValue:
                    'This permanently deletes the observed destination history. Monitoring remains enabled.',
                },
              )}
              okText={t('reset', { defaultValue: 'Reset' })}
              cancelText={t('cancel', { defaultValue: 'Cancel' })}
              okButtonProps={{ danger: true }}
              disabled={controlsDisabled}
              onConfirm={() => runAction('reset')}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={action === 'reset'}
                disabled={controlsDisabled && action !== 'reset'}
              >
                {t('pages.clients.activity.reset', {
                  defaultValue: 'Reset Activity Data',
                })}
              </Button>
            </Popconfirm>

            <div className="client-activity-footer-actions">
              <Button
                icon={<ReloadOutlined />}
                loading={activityLoading}
                disabled={controlsDisabled}
                onClick={() => void loadActivity(activity?.page || 1)}
              >
                {t('refresh', { defaultValue: 'Refresh' })}
              </Button>

              <Button onClick={() => setActivityOpen(false)}>
                {t('close', { defaultValue: 'Close' })}
              </Button>
            </div>
          </div>
        }
      >
        <div className="client-activity-toolbar">
          <Tag color={status?.enabled ? 'green' : 'default'}>
            {status?.enabled
              ? t('pages.clients.activity.monitoringEnabled', {
                  defaultValue: 'Activity Monitoring: Enabled',
                })
              : t('pages.clients.activity.monitoringDisabled', {
                  defaultValue: 'Activity Monitoring: Disabled',
                })}
          </Tag>

          {activity && (
            <span className="client-activity-total">
              {t('pages.clients.activity.totalDestinations', {
                defaultValue: 'Destinations',
              })}: {activity.total}
            </span>
          )}
        </div>

        {activityBody}

        {activity && activity.total > activity.pageSize && (
          <div className="client-activity-pagination">
            <Pagination
              current={activity.page}
              total={activity.total}
              pageSize={activity.pageSize}
              showSizeChanger={false}
              disabled={activityLoading || controlsDisabled}
              onChange={(nextPage) => {
                void loadActivity(nextPage);
              }}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
