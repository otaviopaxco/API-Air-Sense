const express = require('express');
const router = express.Router();

const { authenticateApp } = require('../middleware/auth');
const { appLimiter } = require('../middleware/rateLimiter');
const { registrarPushToken, removerPushToken } = require('../services/notificationService');

/**
 * POST /api/usuarios/:id/push-token
 * Registra o Expo Push Token do celular do usuário logado, para que a API
 * possa notificá-lo quando um alerta for gerado. Chamado pelo app assim
 * que o usuário faz login (e sempre que o token mudar).
 * Body: { token }
 */
router.post('/:id/push-token', authenticateApp, appLimiter, async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ erro: 'Campo "token" é obrigatório.' });
  }

  try {
    await registrarPushToken(req.params.id, token);
    return res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[POST /usuarios/:id/push-token] erro:', err);
    return res.status(500).json({ erro: 'Falha ao registrar push token.' });
  }
});

/**
 * DELETE /api/usuarios/:id/push-token
 * Remove o token (chamado no logout, para parar de receber notificações
 * neste aparelho).
 * Body: { token }
 */
router.delete('/:id/push-token', authenticateApp, appLimiter, async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ erro: 'Campo "token" é obrigatório.' });

  try {
    await removerPushToken(req.params.id, token);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /usuarios/:id/push-token] erro:', err);
    return res.status(500).json({ erro: 'Falha ao remover push token.' });
  }
});

module.exports = router;
