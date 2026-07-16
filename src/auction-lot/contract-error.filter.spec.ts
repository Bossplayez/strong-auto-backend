import { ArgumentsHost, ForbiddenException, UnauthorizedException } from '@nestjs/common';
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
});
