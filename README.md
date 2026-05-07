# REZ Retry Service

A robust retry service with exponential backoff and BullMQ queue integration for the REZ platform.

## Features

- **Exponential Backoff**: Configurable retry strategies (exponential, linear, fixed)
- **BullMQ Integration**: Reliable job queue management with Redis
- **Express Middleware**: Easy integration with existing Express applications
- **Jitter Support**: Prevents thundering herd with random delays
- **Metrics & Monitoring**: Built-in job statistics and tracking
- **TypeScript**: Full type safety with Zod validation

## Installation

```bash
npm install
```

## Configuration

Environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `LOG_LEVEL` | Logging level | `info` |

## Usage

### Basic Setup

```typescript
import { QueueService } from './services/queue.service';
import { RetryService } from './services/retry.service';
import { Redis } from 'ioredis';

// Configure Redis connection
const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Initialize services
const queueService = new QueueService(connection);
const retryService = new RetryService(queueService);

// Create a queue
const queue = queueService.createQueue({
  name: 'my-queue',
  connection,
});

// Schedule a retry
await retryService.scheduleRetry('my-job', { data: 'payload' });
```

### Express Middleware

```typescript
import express from 'express';
import { createRetryMiddleware, retryErrorHandler } from './middleware/retry.middleware';

const app = express();

// Apply retry middleware
app.use(createRetryMiddleware({
  queueService,
  retryService,
  defaultOptions: {
    maxRetries: 3,
    baseDelay: 1000,
  },
}));

// Your routes here
app.get('/api/resource', async (req, res) => {
  // Your implementation
});
```

### Retry Strategies

```typescript
import { RetryStrategy, RETRY_PRESETS } from './models/retry-job.model';

// Use a preset
const fastRetry = RETRY_PRESETS.fast;

// Or configure custom strategy
const customRetry = {
  maxRetries: 5,
  baseDelay: 2000,
  maxDelay: 60000,
  strategy: RetryStrategy.EXPONENTIAL,
  backoffMultiplier: 2,
  jitter: true,
};
```

## API

### QueueService

- `createQueue(config)` - Create a new queue
- `addJob(queueName, jobName, data, options)` - Add a job to queue
- `createWorker(queueName, processor, options)` - Create a job worker
- `getQueueStats(queueName)` - Get queue statistics
- `pauseQueue(queueName)` - Pause queue processing
- `resumeQueue(queueName)` - Resume queue processing

### RetryService

- `calculateDelay(attempt, options)` - Calculate backoff delay
- `shouldRetry(job, options)` - Check if job should retry
- `scheduleRetry(jobName, payload, options, attempt)` - Schedule retry
- `handleFailure(job, error, options)` - Handle failed job
- `getRetryStats(job)` - Get retry statistics

### Middleware

- `createRetryMiddleware(options)` - Create retry middleware
- `retryErrorHandler(options)` - Error handler with retry support
- `withRetry(handler, options)` - Wrapper for retryable handlers
- `queueRateLimitedRequests(options)` - Queue rate-limited requests

## Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## License

MIT
