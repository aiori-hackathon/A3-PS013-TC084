import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';

import { router as authRouter, currentUser } from './auth.js';
import { router as custodyRouter } from './custody.js';
import { router as investigationsRouter } from './investigations.js';
import { router as reportsRouter } from './reports.js';
import { router as assistantRouter } from './assistant.js';
import { router as graphRouter } from './graph.js';
import { router as networkRouter } from './network.js';
import { router as demoRouter } from './demo.js';
import { router as evidenceRouter } from './evidence.js';

export const app = express();

app.use(cookieParser());

// Raw body parser for ingestion endpoints that need exact byte fidelity and SHA-256
app.use('/api/v1/ingest', express.raw({ type: () => true, limit: '2mb' }));
app.use('/api/v1/network/ingest', express.raw({ type: () => true, limit: '5mb' }));

// JSON parser for all other endpoints
app.use(express.json({ limit: '2mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'tracepoint',
  });
});

// Authentication middleware matching Python's _thread_require_login
const PROTECTED_PREFIXES = [
  '/api/v1/timeline',
  '/api/v1/demo',
  '/api/v1/evidence',
  '/api/v1/investigations',
  '/api/v1/graph',
];

app.use((req, res, next) => {
  if (PROTECTED_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    const user = currentUser(req);
    if (!user) {
      return res.status(401).json({ detail: 'Sign in required' });
    }
  }
  next();
});

// Mount routers
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/custody', custodyRouter);
app.use('/api/v1/investigations', investigationsRouter);
app.use('/api/v1/investigations', reportsRouter);
app.use('/api/v1/investigations', assistantRouter);
app.use('/api/v1/graph', graphRouter);
app.use('/api/v1/network', networkRouter);
app.use('/api/v1/demo', demoRouter);
app.use('/api/v1', evidenceRouter);

// Global 404 handler
app.use((req, res) => {
  res.status(404).json({ detail: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  const status = err.status || 500;
  res.status(status).json({ detail: err.message || 'Internal server error' });
});

const PORT = Number.parseInt(process.env.PORT || '8000', 10);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TracePoint Node.js backend listening on http://0.0.0.0:${PORT}`);
  });
}
