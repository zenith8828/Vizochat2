# VizoChat.online — Full-Stack P2P Video Chat with Coin Economy

A mobile-first, dark-navy/neon-cyan glassmorphism social video chat app with a
Spendable/Earned coin economy, gift system, random P2P matchmaking, reporting +
auto-ban, and an admin panel.

## What's real vs. what needs your own keys

This is a genuinely working full-stack app, not a static mockup:

✅ **Fully working out of the box:**
- Express + Socket.io backend with SQLite (atomic transactions for every coin move)
- Real WebRTC P2P video calls between two browsers (signaling via Socket.io)
- Random matchmaking queue + swipe-to-next
- Server-authoritative gift countdown (1 coin = 1 second), consumed/unused coin
  splitting, creator earnings, sender refunds — all computed server-side
- Daily task (+25 coins/day, server-side date check, can't be claimed twice)
- Buy Coins flow with a payment-creation + payment-verification split (coins are
  only ever credited after server-side "verification")
- Report flow that captures a 5-second video clip as evidence (MediaRecorder),
  uploads it privately (never publicly served), and auto-bans a user for 21 days
  once they cross the report threshold in a rolling window
- Admin panel: total/online users, banned users list with email, total earned/
  bought coins, search + ban/unban, and an error-monitoring log
- Demo login so you can run and test everything immediately without any API keys

⚠️ **You must plug in your own credentials for production:**
- **Google Login** — create an OAuth Client ID at
  https://console.cloud.google.com/apis/credentials, put it in
  `server/.env` as `GOOGLE_CLIENT_ID`, and load the Google Identity Services
  script in `client/index.html` (the hookup point is commented in that file).
  Until you do this, the app uses a "Continue with Demo Account" button instead.
- **Payment gateway** — `server/routes/payments.js` has a clearly marked
  `verify` step where you must call your real provider's (Razorpay/Stripe/PayU)
  verification API or webhook signature check before crediting coins. Right now
  it's stubbed to always succeed, for demo purposes only.
- **TURN server** — the WebRTC config in `client/js/videochat.js` only has a
  public STUN server. That works for testing but real-world mobile networks
  often need a TURN relay (e.g. Twilio, coturn) or calls will fail to connect.
- **File/object storage** — report evidence clips are saved to
  `server/uploads/evidence/` on local disk. For real production, move this to
  private cloud storage (S3 private bucket, etc).

## Setup

```bash
cd server
npm install
cp .env.example .env      # edit values as needed
npm start
```

The server serves both the API and the static client at the same port
(default `http://localhost:4000`).

## Making yourself an admin

After logging in once (so your user row exists):

```bash
cd server
node make-admin.js you@example.com
```

Then visit `/admin.html` while logged in as that account.

## Project structure

```
vizochat/
  server/
    index.js              entry point (express + socket.io + cron for ban expiry)
    db.js                  SQLite schema
    routes/                auth, user, coins, payments, reports, admin
    middleware/             JWT auth + ban check
    sockets/index.js        matchmaking, WebRTC signaling relay, gift timer
  client/
    index.html              Google/demo login
    home.html, profile.html, earn.html, remain.html, help.html, camera.html
    video-chat.html + js/videochat.js   main P2P video screen
    admin.html + js/admin.js             admin panel
    css/style.css                        shared neon/glass theme
```

## Coin rules implemented

- **Spendable coins**: purchases + daily task rewards → can be used for gifts.
- **Earned coins**: only credited from gifts received → cannot be spent on
  gifts, cannot be transferred, only for withdrawal.
- Gift flow: sender's coins are reserved immediately, then consumed at
  1 coin/second while the call continues. On swipe/disconnect/report/zero, the
  server (not the client) computes consumed vs. unused coins, credits the
  receiver's earned balance, and refunds unused coins to the sender — all in
  one atomic DB transaction, so it can't be duplicated or manipulated from the
  frontend.

## Known simplifications (documented, not hidden)

- Single-server in-memory matchmaking/gift state (fine for demo/small scale;
  move to Redis for multi-instance horizontal scaling).
- No end-to-end text chat implementation yet — the Chat button is a stub you
  can wire to a socket event the same way gifts/signaling work.
- JWT sessions aren't revocable server-side (no blacklist) — fine for most
  apps, but note it if you need instant force-logout.
