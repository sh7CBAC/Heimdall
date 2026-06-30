import { message } from 'antd';

export default function useDynamicErrorHandler() {
  return ({ error }: { error: unknown }) => {
    const description =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unexpected error';

    message.error(description);
  };
}
