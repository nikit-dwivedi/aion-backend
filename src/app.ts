import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { errorHandler } from './core/middlewares/error.middleware.js';

import authRouter from './features/auth/auth.route.js';
import captureRouter from './features/capture/capture.route.js';
import timelineRouter from './features/timeline/timeline.route.js';
import copilotRouter from './features/copilot/copilot.route.js';
import analyticsRouter from './features/analytics/analytics.route.js';
import projectsRouter from './features/projects/projects.route.js';
import searchRouter from './features/search/search.route.js';
import graphRouter from './features/graph/graph.route.js';
import exportRouter from './features/export/export.route.js';
import planningRouter from './features/planning/planning.route.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.use('/api/auth', authRouter);
app.use('/api/capture', captureRouter);
app.use('/api/timeline', timelineRouter);
app.use('/api/copilot', copilotRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/search', searchRouter);
app.use('/api/graph', graphRouter);
app.use('/api/export', exportRouter);
app.use('/api/planning', planningRouter);

app.use(errorHandler);

export { app };
