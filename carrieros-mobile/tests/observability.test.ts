import { installGlobalErrorHandler, logError } from '@/lib/observability';

describe('mobile observability', () => {
  it('logError writes one structured JSON line with the error serialized', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logError({ where: 'test', orgId: 7 }, new Error('boom'));
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'error', where: 'test', orgId: 7 });
    expect(line.error.message).toBe('boom');
    spy.mockRestore();
  });

  it('global handler logs, then defers to the previous handler', () => {
    const previous = jest.fn();
    let installedHandler: ((e: unknown, fatal?: boolean) => void) | undefined;
    (globalThis as any).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => { installedHandler = h; },
    };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    installGlobalErrorHandler();
    installedHandler!(new Error('fatal one'), true);
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({ where: 'global-handler', isFatal: true });
    expect(previous).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('logError with non-Error values', () => {
  it('keeps the content of an object (e.g. an API error body) instead of "[object Object]"', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logError({ where: 'test' }, { error_code: 'AUTH_REQUIRED', error: 'Unauthorized' });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.error.message).toContain('AUTH_REQUIRED');
    spy.mockRestore();
  });
});
