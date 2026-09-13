const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const PACKAGES = {
  '49': { amount_inr: 49, coins: 125 },
  '99': { amount_inr: 99, coins: 270 },
  '249': { amount_inr: 249, coins: 625 },
  '999': { amount_inr: 999, coins: 2700 }
};

// STEP 1 - Create a pending payment order.
// In production: call your payment provider's order-create API here
// (Razorpay/Stripe/PayU) and return their order id/checkout params to the client.
router.post('/create', requireAuth, (req, res) => {
  const { package_label } = req.body;
  const pkg = PACKAGES[package_label];
  if (!pkg) return res.status(400).json({ error: 'invalid_package' });

  const id = uuid();
  const now = Date.now();
  db.prepare(`INSERT INTO payments (id, user_id, package_label, amount_inr, coins, payment_status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(id, req.user.id, package_label, pkg.amount_inr, pkg.coins, now, now);

  res.json({
    payment_id: id,
    amount_inr: pkg.amount_inr,
    coins: pkg.coins,
    // provider_order_id: <returned by real payment gateway>,
    note: 'Hand this payment_id + provider order params to your payment gateway SDK on the client. Do NOT credit coins yet.'
  });
});

// STEP 2 - Verify payment on the server (e.g. gateway webhook, or signature check
// after client-side checkout success callback). Coins are ONLY credited here,
// never based on a "success" flag sent directly from the frontend.
router.post('/verify', requireAuth, (req, res) => {
  const { payment_id, provider_transaction_id } = req.body;
  const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(payment_id, req.user.id);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  if (payment.payment_status === 'success') {
    return res.status(409).json({ error: 'already_credited' });
  }

  // ---- Real integration point ----
  // Verify `provider_transaction_id` against your payment gateway's API or
  // webhook signature (e.g. Razorpay's crypto.createHmac check) BEFORE crediting.
  // For this demo scaffold we simulate a verified payment.
  const verified = true;
  if (!verified) {
    db.prepare(`UPDATE payments SET payment_status = 'failed', updated_at = ? WHERE id = ?`).run(Date.now(), payment.id);
    return res.status(402).json({ error: 'payment_verification_failed' });
  }

  const now = Date.now();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE payments SET payment_status = 'success', provider_transaction_id = ?, updated_at = ? WHERE id = ?`)
      .run(provider_transaction_id || 'demo-' + uuid(), now, payment.id);

    db.prepare('UPDATE users SET spendable_coins = spendable_coins + ?, updated_at = ? WHERE id = ?')
      .run(payment.coins, now, req.user.id);

    db.prepare(`INSERT INTO coin_transactions (id, user_id, type, amount, source, balance_type, status, meta, created_at)
                VALUES (?, ?, 'credit', ?, 'purchase', 'spendable', 'completed', ?, ?)`)
      .run(uuid(), req.user.id, payment.coins, JSON.stringify({ payment_id }), now);
  });
  tx();

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ok: true, coins_added: payment.coins, new_balance: updated.spendable_coins });
});

router.get('/history', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ payments: rows });
});

module.exports = router;
