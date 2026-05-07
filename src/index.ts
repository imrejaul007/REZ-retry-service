import express from 'express';

const app = express();
app.use(express.json());

interface RetryJob {
  id: string;
  payload: any;
  retries: number;
  maxRetries: number;
  backoff: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
}

const jobs = new Map<string, RetryJob>();

// Exponential backoff
function getBackoff(retries: number): number {
  return Math.min(1000 * Math.pow(2, retries), 30000);
}

// Add job to retry queue
app.post('/add', (req, res) => {
  const { id, payload, maxRetries = 3 } = req.body;
  jobs.set(id, {
    id,
    payload,
    retries: 0,
    maxRetries,
    backoff: 1000,
    status: 'pending',
    createdAt: new Date()
  });
  res.json({ queued: true, id });
});

// Process job with retry
async function processWithRetry(id: string): Promise<any> {
  const job = jobs.get(id);
  if (!job) throw new Error('Job not found');
  
  job.status = 'processing';
  try {
    // Simulate processing
    await new Promise(r => setTimeout(r, 100));
    job.status = 'completed';
    return { success: true };
  } catch (error) {
    job.retries++;
    job.backoff = getBackoff(job.retries);
    if (job.retries >= job.maxRetries) {
      job.status = 'failed';
      return { success: false, reason: 'max retries exceeded' };
    }
    // Schedule retry
    setTimeout(() => processWithRetry(id), job.backoff);
    return { retrying: true, retries: job.retries, backoff: job.backoff };
  }
}

app.post('/process/:id', async (req, res) => {
  const result = await processWithRetry(req.params.id);
  res.json(result);
});

app.get('/status/:id', (req, res) => {
  res.json(jobs.get(req.params.id) || { notFound: true });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', jobs: jobs.size });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Retry service running on ${PORT}`));
