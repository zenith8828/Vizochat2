require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const { v4: uuid } = require('uuid');

const db = require('./db');
const { router: authRouter } = require('./routes/auth');
const userRouter = require('./routes/user');
const coinsRouter = require('./routes/coins');
const paymentsRouter = require('./routes/payments');
const reportsRouter = require('./routes/reports');
const adminRouterFactory = require('./routes/admin');
const { attachSocketHandlers, getOnlineCount } = require('./sockets/index');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Serve the mobile-first client
app.use(express.static(path.join(__dirname, '..', 'client')));

app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/coins', coinsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin', adminRouterFactory(getOnlineCount));

attachSocketHandlers(io);

// Central error logger - captures unexpected server errors for the admin monitoring panel
app.use((err, req, res, next) => {
  try {
    db.prepare('INSERT INTO error_logs (id, message, stack, route, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), err.message, err.stack, req.originalUrl, Date.now());
  } catch (_) { /* ignore logging failure */ }
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

// Auto-restore expired 21-day bans every minute
setInterval(() => {
  const now = Date.now();
  db.prepare(`UPDATE users SET account_status = 'active', ban_started_at = NULL, ban_expires_at = NULL, updated_at = ?
              WHERE account_status = 'banned' AND ban_expires_at IS NOT NULL AND ban_expires_at <= ?`)
    .run(now, now);
}, 60 * 1000);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`VizoChat server running on http://localhost:${PORT}`);
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.log('NOTE: GOOGLE_CLIENT_ID not set - demo login (/api/auth/demo) is active for local testing.');
  }
});
