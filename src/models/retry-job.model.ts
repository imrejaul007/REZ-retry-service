export enum RetryStrategy {
  /** Exponential backoff: 1s, 2s, 4s, 8s... */
  EXPONENTIAL = 'exponential',
  /** Linear backoff: 1s, 2s, 3s, 4s... */
  LINEAR = 'linear',
  /** Fixed delay: same delay every time */
  FIXED = 'fixed',
}

export interface RetryOptions {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelay: number;
  /** Maximum delay cap in milliseconds */
  maxDelay: number;
  /** Backoff strategy to use */
  strategy: RetryStrategy;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Enable random jitter to prevent thundering herd */
  jitter: boolean;
  /** Custom retry condition function */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

export interface RetryJob {
  /** Unique job identifier */
  id: string;
  /** Job name for identification */
  name: string;
  /** Job payload data */
  data: Record<string, unknown>;
  /** Number of attempts already made */
  attemptsMade: number;
  /** Maximum retry attempts allowed */
  maxRetries: number;
  /** Retry configuration options */
  options: Partial<RetryOptions>;
  /** Timestamp when job was created */
  createdAt?: Date;
  /** Timestamp when job finished (success or failure) */
  finishedAt?: Date;
  /** Current job status */
  status?: RetryJobStatus;
  /** Last error message if job failed */
  lastError?: string;
  /** Metadata for job tracking */
  metadata?: Record<string, unknown>;
}

export enum RetryJobStatus {
  PENDING = 'pending',
  RETRYING = 'retrying',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface RetryJobResult {
  success: boolean;
  jobId: string;
  attempts: number;
  duration: number;
  error?: string;
  result?: unknown;
}

export interface RetryConfig {
  /** Default retry options applied to all jobs */
  defaults: Partial<RetryOptions>;
  /** Queue-specific retry configurations */
  queues?: {
    [queueName: string]: Partial<RetryOptions>;
  };
  /** Enable automatic retry for specific error types */
  retryableErrors?: {
    type: string;
    messagePattern?: string;
    options?: Partial<RetryOptions>;
  }[];
}

export interface RetryMetrics {
  /** Total jobs processed */
  totalProcessed: number;
  /** Total successful jobs */
  totalSucceeded: number;
  /** Total failed jobs */
  totalFailed: number;
  /** Total retries triggered */
  totalRetries: number;
  /** Average retry delay */
  averageRetryDelay: number;
  /** Jobs by status */
  byStatus: {
    pending: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  /** Retries by attempt number */
  retriesByAttempt: {
    [attempt: number]: number;
  };
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  strategy: RetryStrategy.EXPONENTIAL,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Preset configurations for common use cases
 */
export const RETRY_PRESETS = {
  /** Fast retries for non-critical operations */
  fast: {
    maxRetries: 2,
    baseDelay: 500,
    maxDelay: 5000,
    strategy: RetryStrategy.EXPONENTIAL,
    backoffMultiplier: 2,
    jitter: true,
  } as RetryOptions,

  /** Standard retries for general operations */
  standard: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    strategy: RetryStrategy.EXPONENTIAL,
    backoffMultiplier: 2,
    jitter: true,
  } as RetryOptions,

  /** Slow retries for critical operations */
  slow: {
    maxRetries: 5,
    baseDelay: 5000,
    maxDelay: 120000,
    strategy: RetryStrategy.EXPONENTIAL,
    backoffMultiplier: 2,
    jitter: true,
  } as RetryOptions,

  /** No jitter for predictable timing */
  predictable: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    strategy: RetryStrategy.EXPONENTIAL,
    backoffMultiplier: 2,
    jitter: false,
  } as RetryOptions,
};
