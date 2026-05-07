import { QueueService } from './services/queue.service';
import { RetryService } from './services/retry.service';
import { RetryStrategy, RETRY_PRESETS } from './models/retry-job.model';

// Redis connection configuration
const redisConnection = {
  host: process.env.REDIS_HOST || process.env.REDIS_URL?.replace('redis://', '').split(':')[0] || 'localhost',
  port: parseInt(process.env.REDIS_PORT || process.env.REDIS_URL?.split(':')[2] || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
};

// Initialize services
const queueService = new QueueService(redisConnection);
const retryService = new RetryService(queueService);

// Define job processors
const jobProcessors: Record<string, (data: Record<string, unknown>) => Promise<unknown>> = {
  'example-job': async (data) => {
    console.log('Processing example job:', data);
    // Simulate work
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { processed: true, data };
  },

  'email-job': async (data) => {
    console.log('Sending email:', data);
    // Email sending logic here
    return { sent: true, recipient: data.email };
  },

  'payment-job': async (data) => {
    console.log('Processing payment:', data);
    // Payment processing logic here
    return { processed: true, transactionId: data.transactionId };
  },
};

// Create workers for each queue
async function startWorkers() {
  const queues = ['default', 'http-retries', 'error-retries', 'rate-limited'];

  for (const queueName of queues) {
    const worker = queueService.createWorker(queueName, async (job) => {
      const processor = jobProcessors[job.name] || jobProcessors['example-job'];

      console.log(`Processing job ${job.id} from queue ${queueName}:`, job.data);

      try {
        const result = await processor(job.data);
        console.log(`Job ${job.id} completed successfully`);
        return result;
      } catch (error) {
        const err = error as Error;
        console.error(`Job ${job.id} failed:`, err.message);

        // Let BullMQ handle retries automatically based on job options
        throw error;
      }
    }, {
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 1000,
      },
    });

    // Set up event listeners
    queueService.setupEventListeners(queueName, {
      onJobComplete: (job) => {
        console.log(`Job ${job.id} completed`);
      },
      onJobFailed: (job, error) => {
        console.error(`Job ${job.id} failed permanently:`, error.message);
      },
      onJobRetrying: (job) => {
        console.log(`Job ${job.id} is being retried (attempt ${job.attemptsMade})`);
      },
    });

    console.log(`Worker started for queue: ${queueName}`);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down workers...');
  await queueService.closeAll();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down workers...');
  await queueService.closeAll();
  process.exit(0);
});

// Start the workers
console.log('Starting REZ Retry Worker...');
startWorkers().catch((error) => {
  console.error('Failed to start workers:', error);
  process.exit(1);
});

console.log('Worker is running and waiting for jobs...');
