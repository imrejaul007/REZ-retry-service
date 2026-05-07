import { Job } from 'bullmq';
import { QueueService } from './queue.service';
import { RetryJob, RetryOptions, RetryStrategy } from '../models/retry-job.model';

export class RetryService {
  private queueService: QueueService;
  private defaultOptions: RetryOptions;

  constructor(queueService: QueueService) {
    this.queueService = queueService;
    this.defaultOptions = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      strategy: RetryStrategy.EXPONENTIAL,
      backoffMultiplier: 2,
      jitter: true,
    };
  }

  /**
   * Calculate delay using exponential backoff
   */
  calculateDelay(attempt: number, options: Partial<RetryOptions> = {}): number {
    const opts = { ...this.defaultOptions, ...options };
    let delay: number;

    switch (opts.strategy) {
      case RetryStrategy.LINEAR:
        delay = opts.baseDelay! * (attempt + 1);
        break;
      case RetryStrategy.FIXED:
        delay = opts.baseDelay!;
        break;
      case RetryStrategy.EXPONENTIAL:
      default:
        delay = opts.baseDelay! * Math.pow(opts.backoffMultiplier!, attempt);
        break;
    }

    // Apply jitter to prevent thundering herd
    if (opts.jitter) {
      const jitterFactor = 0.5 + Math.random() * 0.5; // 50-100% of delay
      delay *= jitterFactor;
    }

    return Math.min(delay, opts.maxDelay!);
  }

  /**
   * Determine if a job should be retried
   */
  shouldRetry(job: Job, options: Partial<RetryOptions> = {}): boolean {
    const opts = { ...this.defaultOptions, ...options };
    const attemptsMade = job.attemptsMade || 0;
    return attemptsMade < opts.maxRetries!;
  }

  /**
   * Schedule a retry for a failed job
   */
  async scheduleRetry(
    jobName: string,
    payload: Record<string, unknown>,
    options: Partial<RetryOptions> = {},
    attempt: number = 0
  ): Promise<Job> {
    const opts = { ...this.defaultOptions, ...options };
    const delay = this.calculateDelay(attempt, opts);

    const retryJob: RetryJob = {
      name: jobName,
      data: payload,
      attemptsMade: attempt,
      maxRetries: opts.maxRetries,
      options: opts,
    };

    return this.queueService.addJob(jobName, payload, {
      delay,
      attempts: opts.maxRetries,
      backoff: {
        type: opts.strategy === RetryStrategy.EXPONENTIAL ? 'exponential' : 'fixed',
        delay: opts.baseDelay,
      },
    });
  }

  /**
   * Handle a failed job and determine retry action
   */
  async handleFailure(
    job: Job,
    error: Error,
    options: Partial<RetryOptions> = {}
  ): Promise<{ shouldRetry: boolean; retryJob?: Job }> {
    const opts = { ...this.defaultOptions, ...options };
    const attemptsMade = job.attemptsMade || 0;

    if (this.shouldRetry(job, opts)) {
      const nextAttempt = attemptsMade + 1;
      const retryJob = await this.scheduleRetry(
        job.name,
        job.data,
        opts,
        nextAttempt
      );

      console.log(
        `Scheduling retry ${nextAttempt}/${opts.maxRetries} for job ${job.id} in ${this.calculateDelay(attemptsMade, opts)}ms`
      );

      return { shouldRetry: true, retryJob };
    }

    console.log(
      `Job ${job.id} failed permanently after ${attemptsMade} attempts: ${error.message}`
    );

    return { shouldRetry: false };
  }

  /**
   * Create a retry handler function for queue processors
   */
  createRetryHandler(
    options: Partial<RetryOptions> = {}
  ): (job: Job, error: Error) => Promise<void> {
    return async (job: Job, error: Error): Promise<void> => {
      await this.handleFailure(job, error, options);
    };
  }

  /**
   * Get retry statistics for a job
   */
  getRetryStats(job: Job): {
    currentAttempt: number;
    maxRetries: number;
    remainingRetries: number;
    estimatedNextDelay: number;
  } {
    const attemptsMade = job.attemptsMade || 0;
    const maxRetries = (job.opts as { maxRetries?: number }).maxRetries || this.defaultOptions.maxRetries!;

    return {
      currentAttempt: attemptsMade,
      maxRetries,
      remainingRetries: Math.max(0, maxRetries - attemptsMade),
      estimatedNextDelay: this.calculateDelay(attemptsMade),
    };
  }
}
