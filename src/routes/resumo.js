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
 * Pensado para a tela inicial do app: só os dispositivos vinculados a esse
 * usuário (usuarios/{uid}/dispositivos), com última leitura por sensor,
 * status derivado (Ativo/Offline/Alerta/Erro) e contagem de alertas — tudo
 * em uma única requisição. Sem `usuarioId`, devolve todos (uso administrativo/depuração).
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

    // Com usuarioId informado, filtra SEMPRE pela lista de vínculos dele —
    // mesmo que esteja vazia (usuário novo deve ver 0 dispositivos, nunca
    // a lista de outra pessoa).
    let idsPermitidos = null;
    if (req.query.usuarioId) {
      const vinculados = await listarDispositivosVinculados(req.query.usuarioId);
      idsPermitidos = new Set(vinculados);
    }

    const contagemPorStatus = { Ativo: 0, Offline: 0, Alerta: 0, Erro: 0 };
    const resumo = Object.entries(dispositivos)
      .filter(([id]) => !idsPermitidos || idsPermitidos.has(id))
      .map(([id, d]) => {
        const alertasNaoResolvidos = alertasNaoResolvidosPorDispositivo[id] || 0;
        const { status, descricao } = calcularStatusDispositivo(d, alertasNaoResolvidos);
        contagemPorStatus[status] = (contagemPorStatus[status] || 0) + 1;
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
      totalAlertasNaoResolvidos: resumo.reduce((soma, d) => soma + d.alertasNaoResolvidos, 0),
      contagemPorStatus,
      dispositivos: resumo,
    });
  } catch (err) {
    console.error('[GET /resumo] erro:', err);
    return res.status(500).json({ erro: 'Falha ao montar resumo.' });
  }
});

module.exports = router;
