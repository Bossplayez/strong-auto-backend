import { ArgumentsHost, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { ContractErrorFilter } from './contract-error.filter';

describe('ContractErrorFilter', () => {
  it.each([
    [new UnauthorizedException(), 401, 'AUTHENTICATION_REQUIRED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
  ])('maps guard failures to the frozen error envelope', (exception, expectedStatus, expectedCode) => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ headers: { 'x-request-id': 'req-1' } }),
      }),
    } as unknown as ArgumentsHost;

    new ContractErrorFilter().catch(exception, host);

    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith({
      contractVersion: 'unified-auction-rc-v1',
      error: {
        code: expectedCode,
        message: expect.any(String),
        fieldErrors: null,
        requestId: 'req-1',
      },
    });
  });

  it('keeps an unexpected error private but records the request context for production diagnosis', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          headers: { 'x-request-id': 'demo-inventory-test' },
          method: 'POST',
          originalUrl: '/api/v1/admin/vehicles/demo-inventory',
        }),
      }),
    } as unknown as ArgumentsHost;

    new ContractErrorFilter().catch(new Error('database column is missing'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      contractVersion: 'unified-auction-rc-v1',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error.',
        fieldErrors: null,
        requestId: 'demo-inventory-test',
      },
    });
    expect(error).toHaveBeenCalledWith(
      '[demo-inventory-test] POST /api/v1/admin/vehicles/demo-inventory failed: database column is missing',
      expect.any(String),
    );
    error.mockRestore();
  });
});
