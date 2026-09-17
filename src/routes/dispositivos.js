const express = require('express');
const router = express.Router();

const { db } = require('../config/firebase');
const { authenticateApp } = require('../middleware/auth');
const { appLimiter } = require('../middleware/rateLimiter');
const {
  renomearDispositivo,
  vincularDispositivoAoUsuario,
  desvincularDispositivoDoUsuario,
} = require('../services/deviceService');

/**
 * PATCH /api/dispositivos/:id/nome
 * Renomeia o dispositivo (cosmético, só para exibição no app).
 * Body: { nome }
 */
router.patch('/:id/nome', authenticateApp, appLimiter, async (req, res) => {
  const { nome } = req.body || {};
  if (!nome || typeof nome !== 'string' || nome.trim().length === 0 || nome.length > 60) {
    return res.status(400).json({ erro: 'Campo "nome" é obrigatório (até 60 caracteres).' });
  }

  try {
    const snap = await db.ref(`dispositivos/${req.params.id}`).once('value');
    if (!snap.exists()) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });

    await renomearDispositivo(req.params.id, nome.trim());
    return res.json({ ok: true, dispositivoId: req.params.id, nome: nome.trim() });
  } catch (err) {
    console.error('[PATCH /dispositivos/:id/nome] erro:', err);
    return res.status(500).json({ erro: 'Falha ao renomear dispositivo.' });
  }
});

/**
 * POST /api/dispositivos/:id/vincular
 * Adiciona o dispositivo à lista pessoal do usuário (tela inicial do app).
 * Body: { usuarioId }
 */
router.post('/:id/vincular', authenticateApp, appLimiter, async (req, res) => {
  const { usuarioId } = req.body || {};
  if (!usuarioId) return res.status(400).json({ erro: 'Campo "usuarioId" é obrigatório.' });

  try {
    const dispositivo = await vincularDispositivoAoUsuario(usuarioId, req.params.id);
    if (!dispositivo) {
      return res.status(404).json({ erro: 'Nenhum dispositivo com esse ID foi encontrado. Confira o ID ou o QR code.' });
    }
    return res.status(201).json({ ok: true, dispositivo: { ...dispositivo, dispositivoId: req.params.id } });
  } catch (err) {
    console.error('[POST /dispositivos/:id/vincular] erro:', err);
    return res.status(500).json({ erro: 'Falha ao vincular dispositivo.' });
  }
});

/**
 * DELETE /api/dispositivos/:id/vincular
 * Remove o dispositivo da lista pessoal do usuário (ícone de lixeira na
 * tela de detalhes). Não apaga o dispositivo real nem seu histórico.
 * Body: { usuarioId }
 */
router.delete('/:id/vincular', authenticateApp, appLimiter, async (req, res) => {
  const { usuarioId } = req.body || {};
  if (!usuarioId) return res.status(400).json({ erro: 'Campo "usuarioId" é obrigatório.' });

  try {
    await desvincularDispositivoDoUsuario(usuarioId, req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /dispositivos/:id/vincular] erro:', err);
    return res.status(500).json({ erro: 'Falha ao remover dispositivo da lista.' });
  }
});

module.exports = router;
