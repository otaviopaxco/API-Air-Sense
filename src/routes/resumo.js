const express = require('express');
const router = express.Router();

const { db } = require('../config/firebase');
const { authenticateApp } = require('../middleware/auth');
const { appLimiter } = require('../middleware/rateLimiter');
const {
  calcularStatusOnline,
  calcularStatusDispositivo,
  listarDispositivosVinculados,
} = require('../services/deviceService');

/**
 * GET /api/resumo?usuarioId=xxx
 * Pensado para a tela inicial do app: dispositivos (do usuário, se
 * `usuarioId` for informado e ele já tiver algum vínculo; senão todos —
 * útil no primeiro uso/single-tenant), com última leitura por sensor,
 * status derivado (Ativo/Offline/Alerta/Erro) e contagem de alertas —
 * tudo em uma única requisição.
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

    let idsPermitidos = null;
    if (req.query.usuarioId) {
      const vinculados = await listarDispositivosVinculados(req.query.usuarioId);
      if (vinculados.length > 0) idsPermitidos = new Set(vinculados);
    }

    const resumo = Object.entries(dispositivos)
      .filter(([id]) => !idsPermitidos || idsPermitidos.has(id))
      .map(([id, d]) => {
        const alertasNaoResolvidos = alertasNaoResolvidosPorDispositivo[id] || 0;
        const { status, descricao } = calcularStatusDispositivo(d, alertasNaoResolvidos);
        return {
          dispositivoId: id,
          nome: d.nome || d.modelo,
          modelo: d.modelo,
          ativo: d.ativo !== false,
          online: calcularStatusOnline(d.ultimoContato),
          status,
          descricaoStatus: descricao,
          ultimoContato: d.ultimoContato || null,
          ultimaLeitura: d.ultimaLeitura || {},
          alertasNaoResolvidos,
        };
      });

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
