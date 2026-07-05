import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl } = req;
    const start = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - start;
      const color =
        statusCode >= 500
          ? '\x1b[31m'
          : statusCode >= 400
            ? '\x1b[33m'
            : statusCode >= 300
              ? '\x1b[36m'
              : '\x1b[32m';

      this.logger.log(
        `${color}${method}\x1b[0m ${originalUrl} -> ${color}${statusCode}\x1b[0m (${duration}ms)`,
      );
    });

    next();
  }
}
