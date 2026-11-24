import {
  type ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ApiException } from './api.exception';
import { GlobalExceptionFilter } from './global-exception.filter';

function createHost(requestId?: string) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: requestId, method: 'GET', originalUrl: '/api/v1/test' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  beforeAll(() => {
    // Silence the expected error log for the 500 case.
    Logger.overrideLogger(false);
  });

  it('maps ApiException with its code and field errors', () => {
    const { host, status, json } = createHost('req-1');
    filter.catch(
      new ApiException(400, 'VALIDATION_FAILED', 'Request validation failed.', [
        { path: 'email', message: 'Invalid email' },
      ]),
      host,
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed.',
        statusCode: 400,
        requestId: 'req-1',
        fieldErrors: [{ path: 'email', message: 'Invalid email' }],
      },
    });
  });

  it('maps built-in HttpExceptions to codes by status', () => {
    const { host, status, json } = createHost();
    filter.catch(new NotFoundException('Cannot GET /api/v1/nope'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0].error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Cannot GET /api/v1/nope',
    });
  });

  it('joins array messages from BadRequestException', () => {
    const { host, json } = createHost();
    filter.catch(new BadRequestException(['a is required', 'b is required']), host);
    expect(json.mock.calls[0][0].error.message).toBe('a is required; b is required');
  });

  it('maps throttling to RATE_LIMITED', () => {
    const { host, status, json } = createHost();
    filter.catch(new ThrottlerException(), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json.mock.calls[0][0].error.code).toBe('RATE_LIMITED');
  });

  it('maps body-parser errors', () => {
    const tooLarge = createHost();
    filter.catch({ type: 'entity.too.large', status: 413 }, tooLarge.host);
    expect(tooLarge.status).toHaveBeenCalledWith(413);
    expect(tooLarge.json.mock.calls[0][0].error.code).toBe('PAYLOAD_TOO_LARGE');

    const malformed = createHost();
    filter.catch({ type: 'entity.parse.failed', status: 400 }, malformed.host);
    expect(malformed.status).toHaveBeenCalledWith(400);
    expect(malformed.json.mock.calls[0][0].error.code).toBe('BAD_REQUEST');
  });

  it('hides internal details of unknown errors', () => {
    const { host, status, json } = createHost('req-9');
    filter.catch(new Error('connection string postgres://secret@db leaked'), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      statusCode: 500,
      requestId: 'req-9',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
