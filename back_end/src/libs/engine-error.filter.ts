import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { EngineError } from '../engine/types';

const STATUS = { 'not-found': 404, conflict: 409, 'bad-request': 400 } as const;
const NAME = {
  'not-found': 'Not Found',
  conflict: 'Conflict',
  'bad-request': 'Bad Request',
} as const;

/** Turns the engine's own errors into the 4xx answers they stand for. */
@Catch(EngineError)
export class EngineErrorFilter implements ExceptionFilter {
  catch(error: EngineError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = STATUS[error.kind];
    response
      .status(statusCode)
      .json({ statusCode, error: NAME[error.kind], message: error.message });
  }
}
