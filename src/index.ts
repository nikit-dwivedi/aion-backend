import express from 'express';
import captureRoute from './routes/capture.route.ts';
import searchRoute from './routes/search.route.ts';
import timelineRoute from './routes/timeline.route.ts';
import projectsRoute from './routes/projects.route.ts';
import copilotRoute from './routes/copilot.route.ts';
import planningRoute from './routes/planning.route.ts';
import graphRoute from './routes/graph.route.ts';
import exportRoute from './routes/export.route.ts';
import analyticsRoute from './routes/analytics.route.ts';
import authRoute from './routes/auth.route.ts';
import { authMiddleware } from './middleware/auth.middleware.ts';
import { startWorker } from './worker.ts';

const app = express();
const port = 3000;

app.use(express.json({ limit: '20mb' }));

// Auth Routes (Public)
app.use('/api/auth', authRoute);

// Protected Routes
app.use('/api/capture', authMiddleware, captureRoute);
app.use('/api/search', authMiddleware, searchRoute);
app.use('/api/timeline', authMiddleware, timelineRoute);
app.use('/api/projects', authMiddleware, projectsRoute);
app.use('/api/copilot', authMiddleware, copilotRoute);
app.use('/api/planning', authMiddleware, planningRoute);
app.use('/api/graph', authMiddleware, graphRoute);
app.use('/api/export', authMiddleware, exportRoute);
app.use('/api/analytics', authMiddleware, analyticsRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`AION Backend running on http://localhost:${port}`);
  startWorker();
});
