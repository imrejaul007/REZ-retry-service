import { Queue, Worker, Job, QueueEvents, ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

export interface QueueConfig {
  name: string;
  connection: ConnectionOptions;
  defaultJobOptions?: {
    attempts?: number;
    backoff?: {
      type: 'exponential' | 'fixed';
      delay?: number;
    };
    removeOnComplete?: boolean | { count?: number };
    removeOnFail?: boolean | { count?: number };
  };
}

export interface JobData {
  id?: string;
  name: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class QueueService {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private connection: ConnectionOptions;

  constructor(connection: ConnectionOptions) {
    this.connection = connection;
  }

  /**
   * Create or get a queue by name
   */
  createQueue(config: QueueConfig): Queue {
    const { name, defaultJobOptions = {} } = config;

    if (this.queues.has(name)) {
      return this.queues.get(name)!;
    }

    const queue = new Queue(name, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
        ...defaultJobOptions,
      },
    });

    this.queues.set(name, queue);
    return queue;
  }

  /**
   * Add a job to a queue
   */
  async addJob<T extends JobData>(
    queueName: string,
    jobName: string,
    data: Record<string, unknown>,
    options?: {
      delay?: number;
      attempts?: number;
      backoff?: {
        type: 'exponential' | 'fixed';
        delay?: number;
      };
      priority?: number;
      jobId?: string;
    }
  ): Promise<Job> {
    let queue = this.queues.get(queueName);

    if (!queue) {
      queue = this.createQueue({ name: queueName, connection: this.connection });
    }

    const jobId = options?.jobId || uuidv4();

    const job = await queue.add(jobName, data, {
      jobId,
      delay: options?.delay,
      attempts: options?.attempts,
      backoff: options?.backoff,
      priority: options?.priority,
    });

    return job;
  }

  /**
   * Create a worker for processing jobs
   */
  createWorker(
    queueName: string,
    processor: (job: Job) => Promise<unknown>,
    options?: {
      concurrency?: number;
      limiter?: {
        max: number;
        duration: number;
      };
    }
  ): Worker {
    let worker = this.workers.get(queueName);

    if (worker) {
      worker.close();
    }

    worker = new Worker(queueName, processor, {
      connection: this.connection,
      concurrency: options?.concurrency || 5,
      limiter: options?.limiter,
    });

    worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed successfully`);
    });

    worker.on('failed', (job, err) => {
      console.error(`Job ${job?.id} failed:`, err.message);
    });

    worker.on('error', (err) => {
      console.error(`Worker error for queue ${queueName}:`, err);
    });

    this.workers.set(queueName, worker);
    return worker;
  }

  /**
   * Set up queue event listeners
   */
  setupEventListeners(
    queueName: string,
    callbacks?: {
      onJobComplete?: (job: Job) => void;
      onJobFailed?: (job: Job, error: Error) => void;
      onJobProgress?: (job: Job, progress: number | object) => void;
      onJobRetrying?: (job: Job) => void;
    }
  ): QueueEvents {
    let events = this.queueEvents.get(queueName);

    if (events) {
      events.close();
    }

    events = new QueueEvents(queueName, {
      connection: this.connection,
    });

    if (callbacks?.onJobComplete) {
      events.on('completed', ({ jobId }) => {
        this.getJob(queueName, jobId).then((job) => {
          if (job) callbacks.onJobComplete!(job);
        });
      });
    }

    if (callbacks?.onJobFailed) {
      events.on('failed', ({ jobId, failedReason }) => {
        this.getJob(queueName, jobId).then((job) => {
          if (job) callbacks.onJobFailed!(job, new Error(failedReason));
        });
      });
    }

    if (callbacks?.onJobProgress) {
      events.on('progress', ({ jobId, data }) => {
        this.getJob(queueName, jobId).then((job) => {
          if (job) callbacks.onJobProgress!(job, data);
        });
      });
    }

    if (callbacks?.onJobRetrying) {
      events.on('retries-exhausted', ({ jobId }) => {
        this.getJob(queueName, jobId).then((job) => {
          if (job) callbacks.onJobRetrying!(job);
        });
      });
    }

    this.queueEvents.set(queueName, events);
    return events;
  }

  /**
   * Get a job by ID
   */
  async getJob(queueName: string, jobId: string): Promise<Job | undefined> {
    const queue = this.queues.get(queueName);
    if (!queue) return undefined;
    return queue.getJob(jobId);
  }

  /**
   * Get jobs by status
   */
  async getJobs(
    queueName: string,
    types: ('waiting' | 'active' | 'completed' | 'failed' | 'delayed')[],
    start?: number,
    end?: number
  ): Promise<Job[]> {
    const queue = this.queues.get(queueName);
    if (!queue) return [];

    const jobs: Job[] = [];
    for (const type of types) {
      const typeJobs = await queue.getJobs(type, start, end);
      jobs.push(...typeJobs);
    }

    return jobs;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.pause();
    }
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.resume();
    }
  }

  /**
   * Drain a queue (process all waiting jobs)
   */
  async drainQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.drain();
    }
  }

  /**
   * Clean old jobs from a queue
   */
  async cleanQueue(
    queueName: string,
    grace: number = 24 * 60 * 60 * 1000,
    status: 'completed' | 'failed' = 'completed'
  ): Promise<string[]> {
    const queue = this.queues.get(queueName);
    if (!queue) return [];

    return queue.clean(grace, 100, status);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }

    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    return counts as { waiting: number; active: number; completed: number; failed: number; delayed: number };
  }

  /**
   * Close all queues and workers
   */
  async closeAll(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const worker of this.workers.values()) {
      closePromises.push(worker.close());
    }

    for (const events of this.queueEvents.values()) {
      closePromises.push(events.close());
    }

    for (const queue of this.queues.values()) {
      closePromises.push(queue.close());
    }

    await Promise.all(closePromises);
    this.queues.clear();
    this.workers.clear();
    this.queueEvents.clear();
  }
}
