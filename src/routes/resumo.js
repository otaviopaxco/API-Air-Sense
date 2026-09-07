const express = require('express');
const router = express.Router();

const { db } = require('../config/firebase');
const { authenticateApp } = require('../middleware/auth');
const { appLimiter } = require('../middleware/rateLimiter');
const { calcularStatusOnline } = require('../services/deviceService');

/**
 * GET /api/resumo
 * Pensado para a tela inicial do app: todos os dispositivos, com sua
 * última leitura por tipo de sensor, status online/offline calculado a
 * partir do heartbeat, e contagem de alertas não resolvidos — tudo em
 * uma única requisição (evita N chamadas do app a cada abertura de tela).
 */
router.get('/', authenticateApp, appLimiter, async (req, res) => {
  try {
    const [dispositivosSnap, alertasSnap] = await Promise.all([
      db.ref('dispositivos').once('value'),
      db.ref('alertas').once('value'),
    ]);

    const dispositivos = dispositivosSnap.val() || {};
    const alertas = alertasSnap.val() || {};

    const alertasNaoResolvidosPorDispositivo = {};
    for (const alerta of Object.values(alertas)) {
      if (alerta.resolvido === false && alerta.dispositivoId) {
        alertasNaoResolvidosPorDispositivo[alerta.dispositivoId] =
          (alertasNaoResolvidosPorDispositivo[alerta.dispositivoId] || 0) + 1;
      }
    }

    const resumo = Object.entries(dispositivos).map(([id, d]) => ({
      dispositivoId: id,
      modelo: d.modelo,
      ativo: d.ativo !== false,
      online: calcularStatusOnline(d.ultimoContato),
      ultimoContato: d.ultimoContato || null,
      ultimaLeitura: d.ultimaLeitura || {},
      alertasNaoResolvidos: alertasNaoResolvidosPorDispositivo[id] || 0,
    }));

    return res.json({
      geradoEm: new Date().toISOString(),
      totalDispositivos: resumo.length,
      dispositivosOnline: resumo.filter((d) => d.online).length,
      totalAlertasNaoResolvidos: Object.values(alertasNaoResolvidosPorDispositivo).reduce((a, b) => a + b, 0),
      dispositivos: resumo,
    });
  } catch (err) {
    console.error('[GET /resumo] erro:', err);
    return res.status(500).json({ erro: 'Falha ao montar resumo.' });
  }
});

module.exports = router;
