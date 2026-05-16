'use strict';

const express = require('express');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (nginx)
app.set('trust proxy', 1);

app.use(express.json({ limit: '10kb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Rate limit: 5 submissions per IP per 15 min
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests. Please try again later.' }
});

// Nodemailer transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/contact', limiter, async (req, res) => {
  const { name, phone, email, interest, message } = req.body || {};

  if (!name || !phone || !interest) {
    return res.status(400).json({ error: 'Brakuje wymaganych pól.' });
  }

  // Sanitize inputs
  const safe = (s) => String(s || '').slice(0, 500).replace(/[<>]/g, '');

  const interestLabels = {
    'own-car': 'Praca z własnym autem',
    'rental': 'Wynajem auta z floty',
    'student': 'Oferta studencka',
    'info': 'Ogólne pytania'
  };

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:600px;background:#0e0e18;color:#f0f0fa;padding:32px;border-radius:12px;border:1px solid #1f1f35">
      <h2 style="color:#f5c518;margin-top:0">🚕 Nowe zgłoszenie — CalmDriver Taxi</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#7070a0;width:140px">Imię</td><td style="padding:8px 0;font-weight:bold">${safe(name)}</td></tr>
        <tr><td style="padding:8px 0;color:#7070a0">Telefon</td><td style="padding:8px 0;font-weight:bold;color:#f5c518">${safe(phone)}</td></tr>
        <tr><td style="padding:8px 0;color:#7070a0">Email</td><td style="padding:8px 0">${safe(email) || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#7070a0">Zainteresowanie</td><td style="padding:8px 0">${interestLabels[interest] || safe(interest)}</td></tr>
        <tr><td style="padding:8px 0;color:#7070a0;vertical-align:top">Wiadomość</td><td style="padding:8px 0">${safe(message) || '—'}</td></tr>
      </table>
      <hr style="border:1px solid #1f1f35;margin:20px 0"/>
      <p style="color:#7070a0;font-size:12px">Wysłano z formularza na calmdriver.pl</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"CalmDriver Formularz" <${process.env.SMTP_USER}>`,
      to: process.env.MAIL_TO || 'calmdrivertaxi@gmail.com',
      replyTo: email || undefined,
      subject: `Nowe zgłoszenie: ${safe(name)} — ${interestLabels[interest] || interest}`,
      html: htmlBody
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Mail error:', err.message);
    res.status(500).json({ error: 'Błąd wysyłania wiadomości.' });
  }
});

app.listen(PORT, () => {
  console.log(`CalmDriver API running on :${PORT}`);
});
