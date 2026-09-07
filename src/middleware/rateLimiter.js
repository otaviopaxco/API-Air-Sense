const rateLimit = require('express-rate-limit');

// Cada ESP32 envia 1 leitura a cada ~20s por tipo de sensor (~180-900/h
// dependendo de quantos tipos ele reporta). Usamos o dispositivoId como
// chave em vez do IP: assim um ESP32 barulhento não consome a cota de
// outro dispositivo que esteja atrás do mesmo roteador/NAT.
const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // até 60 leituras/min por dispositivo (folga para 5 sensores a cada 20s + reenvios)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.dispositivoId || req.ip,
  message: { erro: 'Muitas requisições deste dispositivo em pouco tempo.' },
});

const appLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições do aplicativo em pouco tempo.' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições administrativas em pouco tempo.' },
});

module.exports = { deviceLimiter, appLimiter, adminLimiter };
