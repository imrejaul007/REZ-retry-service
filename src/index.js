const express = require('express');
const app = express();
app.use(express.json());

const jobs = new Map();

app.post('/add', (req, res) => {
  const { id, payload, maxRetries = 3 } = req.body;
  jobs.set(id, { id, payload, retries: 0, maxRetries, backoff: 1000, status: 'pending', createdAt: new Date() });
  res.json({ queued: true, id });
});

app.get('/status/:id', (req, res) => {
  res.json(jobs.get(req.params.id) || { notFound: true });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', jobs: jobs.size });
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log('Retry running on', PORT));
