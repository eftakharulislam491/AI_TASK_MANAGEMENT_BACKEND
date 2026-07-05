import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const errors = exception.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));

    response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      success: false,
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      message: 'Validation failed',
      errors,
    });
  }
}
