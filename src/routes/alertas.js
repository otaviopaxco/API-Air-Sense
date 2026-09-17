const express = require('express');
const router = express.Router();

const { db } = require('../config/firebase');
const { authenticateApp } = require('../middleware/auth');
const { appLimiter } = require('../middleware/rateLimiter');
const { dispensarAlerta } = require('../services/firebaseService');

/**
 * GET /api/alertas/lista?status=ativos|dispensados
 * Lista alertas já com o nome/modelo do dispositivo embutido (evita o app
 * ter que cruzar com /dispositivos manualmente), mais recentes primeiro.
 */
router.get('/lista', authenticateApp, appLimiter, async (req, res) => {
  try {
    const [alertasSnap, dispositivosSnap] = await Promise.all([
      db.ref('alertas').once('value'),
      db.ref('dispositivos').once('value'),
    ]);

    const alertas = alertasSnap.val() || {};
    const dispositivos = dispositivosSnap.val() || {};
    const filtro = req.query.status;

    let lista = Object.entries(alertas).map(([id, a]) => ({
      id,
      ...a,
      nomeDispositivo: dispositivos[a.dispositivoId]?.nome || dispositivos[a.dispositivoId]?.modelo || a.dispositivoId,
    }));

    if (filtro === 'ativos') lista = lista.filter((a) => a.resolvido === false);
    if (filtro === 'dispensados') lista = lista.filter((a) => a.resolvido === true);
    if (req.query.dispositivoId) lista = lista.filter((a) => a.dispositivoId === req.query.dispositivoId);

    lista.sort((a, b) => new Date(b.horario) - new Date(a.horario));

    return res.json({ total: lista.length, alertas: lista });
  } catch (err) {
    console.error('[GET /alertas/lista] erro:', err);
    return res.status(500).json({ erro: 'Falha ao listar alertas.' });
  }
});

/**
 * POST /api/alertas/:id/dispensar
 * Só dispensa (resolvido = true) se as últimas 5 leituras do mesmo tipo de
 * sensor, no mesmo dispositivo, estiverem normais. Caso contrário retorna
 * 409 com o motivo, e o app deve manter o alerta como ativo.
 */
router.post('/:id/dispensar', authenticateApp, appLimiter, async (req, res) => {
  try {
    const resultado = await dispensarAlerta(req.params.id);

    if (!resultado.encontrado) {
      return res.status(404).json({ erro: 'Alerta não encontrado.' });
    }
    if (!resultado.permitido) {
      return res.status(409).json({ erro: 'Alerta ainda ativo.', motivo: resultado.motivo });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /alertas/:id/dispensar] erro:', err);
    return res.status(500).json({ erro: 'Falha ao dispensar alerta.' });
  }
});

module.exports = router;
