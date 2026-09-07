const express = require('express');
const router = express.Router();

const { authenticateAdmin } = require('../middleware/auth');
const { adminLimiter } = require('../middleware/rateLimiter');
const { provisionarDispositivo } = require('../services/deviceService');
const {
  agregarLeiturasDaUltimaHora,
  purgarLeiturasHorariasAntigas,
} = require('../services/firebaseService');

/**
 * POST /api/admin/dispositivos
 * Cadastra um novo ESP32 e gera uma chave de API exclusiva para ele.
 * A chave só é retornada NESTA resposta — grave-a no firmware imediatamente,
 * ela não pode ser recuperada depois (só reemitida, invalidando a antiga).
 *
 * Body opcional: { id, modelo, sensores }
 */
router.post('/dispositivos', authenticateAdmin, adminLimiter, async (req, res) => {
  try {
    const { id, modelo, sensores } = req.body || {};
    const { dispositivoId, chaveApi } = await provisionarDispositivo({ id, modelo, sensores });
    return res.status(201).json({
      dispositivoId,
      chaveApi,
      aviso: 'Guarde esta chave agora — ela não será mostrada novamente.',
    });
  } catch (err) {
    console.error('[POST /admin/dispositivos] erro:', err);
    return res.status(500).json({ erro: 'Falha ao provisionar dispositivo.' });
  }
});

/**
 * POST /api/admin/agregar-agora
 * Roda manualmente o job que normalmente executa 1x por hora: calcula a
 * média da última hora fechada por dispositivo, salva em
 * leituras_horarias e apaga as leituras brutas já processadas.
 * Útil SÓ PARA TESTES — em produção deixe o cron cuidar disso sozinho.
 */
router.post('/agregar-agora', authenticateAdmin, adminLimiter, async (req, res) => {
  try {
    const resultado = await agregarLeiturasDaUltimaHora();
    return res.json({ ok: true, dispositivosProcessados: resultado.length, detalhes: resultado });
  } catch (err) {
    console.error('[POST /admin/agregar-agora] erro:', err);
    return res.status(500).json({ erro: 'Falha ao agregar leituras.' });
  }
});

/**
 * POST /api/admin/purgar-agora
 * Roda manualmente o job de limpeza de médias horárias antigas.
 * Body opcional: { dias } — padrão HOURLY_RETENTION_DAYS (7).
 * Útil SÓ PARA TESTES.
 */
router.post('/purgar-agora', authenticateAdmin, adminLimiter, async (req, res) => {
  try {
    const dias = Number(req.body?.dias) || Number(process.env.HOURLY_RETENTION_DAYS) || 7;
    const resultado = await purgarLeiturasHorariasAntigas(dias);
    return res.json({ ok: true, ...resultado, diasRetencao: dias });
  } catch (err) {
    console.error('[POST /admin/purgar-agora] erro:', err);
    return res.status(500).json({ erro: 'Falha ao purgar dados antigos.' });
  }
});

module.exports = router;
