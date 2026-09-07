const express = require('express');
const router = express.Router();

const { db } = require('../config/firebase');
const { authenticateDevice, authenticateApp } = require('../middleware/auth');
const { deviceLimiter, appLimiter } = require('../middleware/rateLimiter');
const { validarLeitura } = require('../validators/leituraValidator');
const { gravarLeitura } = require('../services/firebaseService');

/**
 * POST /api/leituras
 * Chamado pelo ESP32 a cada ~20s.
 * Body: { dispositivoId, tipo, valor, horarioLeitura? }
 */
router.post('/', authenticateDevice, deviceLimiter, async (req, res) => {
  const { valido, erros, dados } = validarLeitura(req.body);

  if (!valido) {
    return res.status(400).json({ erro: 'Payload inválido.', detalhes: erros });
  }

  try {
    const { id, timestamp } = await gravarLeitura(dados);
    return res.status(201).json({ ok: true, id, horarioLeitura: timestamp });
  } catch (err) {
    console.error('[POST /leituras] erro ao gravar:', err);
    return res.status(500).json({ erro: 'Falha ao gravar leitura no banco de dados.' });
  }
});

/**
 * GET /api/leituras/:dispositivoId
 * Leituras brutas (última hora ainda não agregada) de um dispositivo.
 * Uso: app/dashboard.
 */
router.get('/:dispositivoId', authenticateApp, appLimiter, async (req, res) => {
  try {
    const snap = await db.ref(`leituras/${req.params.dispositivoId}`).once('value');
    return res.json(snap.val() || {});
  } catch (err) {
    console.error('[GET /leituras/:id] erro:', err);
    return res.status(500).json({ erro: 'Falha ao consultar leituras.' });
  }
});

/**
 * GET /api/leituras/:dispositivoId/horarias?dias=7
 * Médias horárias já agregadas, opcionalmente filtradas pelos últimos N dias.
 * Uso: gráficos do dashboard.
 */
router.get('/:dispositivoId/horarias', authenticateApp, appLimiter, async (req, res) => {
  try {
    const snap = await db.ref(`leituras_horarias/${req.params.dispositivoId}`).once('value');
    const todas = snap.val() || {};

    const dias = Number(req.query.dias) || null;
    if (!dias) return res.json(todas);

    const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
    const filtradas = Object.fromEntries(
      Object.entries(todas).filter(([hourKey]) => new Date(`${hourKey}:00:00.000Z`).getTime() >= limite)
    );
    return res.json(filtradas);
  } catch (err) {
    console.error('[GET /leituras/:id/horarias] erro:', err);
    return res.status(500).json({ erro: 'Falha ao consultar médias horárias.' });
  }
});

module.exports = router;
