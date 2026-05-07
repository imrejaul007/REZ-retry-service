import { Request, Response, NextFunction } from 'express';
import { QueueService } from '../services/queue.service';
import { RetryService } from '../services/retry.service';
import { RetryOptions, RetryStrategy } from '../models/retry-job.model';

export interface RetryMiddlewareOptions {
  queueService: QueueService;
  retryService: RetryService;
  queueName?: string;
  defaultOptions?: Partial<RetryOptions>;
}

/**
 * Middleware factory for automatic retry on failed requests
 */
export function createRetryMiddleware(options: RetryMiddlewareOptions) {
  const { queueService, retryService, queueName = 'http-requests', defaultOptions = {} } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;
    const originalJson = res.json;

    let responseSent = false;

    const handleResponse = (body?: unknown) => {
      if (responseSent) return;
      responseSent = true;
    };

    res.send = function (body?: unknown): Response {
      handleResponse(body);
      return originalSend.call(this, body);
    };

    res.json = function (body?: unknown): Response {
      handleResponse(body);
      return originalJson.call(this, body);
    };

    // Store retry context on request
    (req as any).retryContext = {
      queueName,
      retryService,
      queueService,
      options: defaultOptions,
    };

    next();
  };
}

/**
 * Queue a failed operation for retry
 */
export async function queueForRetry(
  req: Request,
  jobName: string,
  payload: Record<string, unknown>,
  options?: Partial<RetryOptions>
): Promise<void> {
  const context = (req as any).retryContext;
  if (!context) {
    throw new Error('Retry middleware not properly configured');
  }

  const { queueService, retryService, queueName } = context;
  const retryOptions = { ...context.options, ...options };

  await retryService.scheduleRetry(jobName, payload, retryOptions);
}

/**
 * Check if request is a retry attempt
 */
export function isRetryRequest(req: Request): boolean {
  const retryCount = req.headers['x-retry-count'];
  return retryCount !== undefined && parseInt(retryCount as string, 10) > 0;
}

/**
 * Get retry count from request
 */
export function getRetryCount(req: Request): number {
  const retryCount = req.headers['x-retry-count'];
  if (!retryCount) return 0;
  return parseInt(retryCount as string, 10);
}

/**
 * Add retry headers to response
 */
export function addRetryHeaders(res: Response, retryCount: number, maxRetries: number): void {
  res.setHeader('X-Retry-Count', retryCount.toString());
  res.setHeader('X-Max-Retries', maxRetries.toString());
  res.setHeader('X-Retry-Attempt', `${retryCount}/${maxRetries}`);
}

/**
 * Express error handler middleware with retry support
 */
export function retryErrorHandler(
  options: RetryMiddlewareOptions = {} as RetryMiddlewareOptions
) {
  const { retryService, queueService, queueName = 'error-retries', defaultOptions = {} } = options;

  return async (err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(`Error handling request ${req.path}:`, err.message);

    const retryCount = getRetryCount(req);
    const opts = { ...defaultOptions, maxRetries: defaultOptions.maxRetries || 3 };

    if (retryCount < (opts.maxRetries || 3)) {
      // Queue for retry
      await retryService.scheduleRetry(
        `error-${req.path}`,
        {
          path: req.path,
          method: req.method,
          body: req.body,
          query: req.query,
          originalError: err.message,
          retryCount: retryCount + 1,
        },
        opts,
        retryCount
      );

      addRetryHeaders(res, retryCount + 1, opts.maxRetries || 3);
      return res.status(503).json({
        error: 'Request queued for retry',
        retryCount: retryCount + 1,
        message: 'The request has been queued and will be retried',
      });
    }

    // Max retries exceeded
    return res.status(500).json({
      error: 'Request failed after maximum retries',
      message: err.message,
    });
  };
}

/**
 * Create a retryable route handler
 */
export function withRetry<T>(
  handler: (req: Request, res: Response) => Promise<T>,
  options: {
    retryable?: boolean;
    retryOptions?: Partial<RetryOptions>;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
) {
  return async (req: Request, res: Response) => {
    const retryCount = getRetryCount(req);
    const maxRetries = options.retryOptions?.maxRetries || 3;
    const retryable = options.retryable !== false;

    try {
      addRetryHeaders(res, retryCount, maxRetries);
      const result = await handler(req, res);
      return result;
    } catch (error) {
      const err = error as Error;

      if (options.onRetry) {
        options.onRetry(err, retryCount);
      }

      if (retryable && retryCount < maxRetries) {
        console.log(`Retrying request to ${req.path}, attempt ${retryCount + 1}/${maxRetries}`);
        // The error will trigger the retry middleware to queue the request
        throw error;
      }

      throw error;
    }
  };
}

/**
 * Rate limiting middleware that uses queues for rate limit responses
 */
export function queueRateLimitedRequests(
  options: RetryMiddlewareOptions = {} as RetryMiddlewareOptions
) {
  const { queueService, queueName = 'rate-limited', retryService } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // If rate limited, queue the request
    if (res.statusCode === 429) {
      const delay = parseInt(res.getHeader('Retry-After') as string || '1000', 10);

      await queueService.addJob(queueName, `rate-limited-${req.path}`, {
        path: req.path,
        method: req.method,
        body: req.body,
        query: req.query,
        headers: req.headers,
      }, {
        delay,
      });

      return res.status(202).json({
        message: 'Rate limited request queued for later processing',
        queuedAt: new Date().toISOString(),
      });
    }

    next();
  };
}
