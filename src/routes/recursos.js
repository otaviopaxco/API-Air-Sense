const express = require('express');
const router = express.Router();

const { db } = require('../config/firebase');
const { authenticateApp } = require('../middleware/auth');
const { appLimiter } = require('../middleware/rateLimiter');
const { calcularStatusOnline, calcularStatusDispositivo } = require('../services/deviceService');

// Campos sensíveis que nunca devem sair da API para o app.
const CAMPOS_OCULTOS = {
  dispositivos: ['auth'], // salt+hash da chave do ESP32
};

function removerCamposOcultos(caminho, objeto) {
  const ocultos = CAMPOS_OCULTOS[caminho];
  if (!ocultos || !objeto) return objeto;
  const copia = { ...objeto };
  ocultos.forEach((campo) => delete copia[campo]);
  return copia;
}

// Fábrica de rotas GET simples para nós de nível superior do banco.
function crudSimples(caminho) {
  const r = express.Router();

  r.get('/', authenticateApp, appLimiter, async (req, res) => {
    try {
      const snap = await db.ref(caminho).once('value');
      const dados = snap.val() || {};
      const limpos = Object.fromEntries(
        Object.entries(dados).map(([id, valor]) => [id, removerCamposOcultos(caminho, valor)])
      );
      res.json(limpos);
    } catch (err) {
      console.error(`[GET /${caminho}] erro:`, err);
      res.status(500).json({ erro: `Falha ao consultar ${caminho}.` });
    }
  });

  r.get('/:id', authenticateApp, appLimiter, async (req, res) => {
    try {
      const [snap, alertasSnap] = await Promise.all([
        db.ref(`${caminho}/${req.params.id}`).once('value'),
        caminho === 'dispositivos' ? db.ref('alertas').once('value') : Promise.resolve(null),
      ]);
      if (!snap.exists()) return res.status(404).json({ erro: 'Não encontrado.' });

      const limpo = removerCamposOcultos(caminho, snap.val());

      if (caminho === 'dispositivos') {
        const alertas = alertasSnap.val() || {};
        const alertasNaoResolvidos = Object.values(alertas).filter(
          (a) => a.dispositivoId === req.params.id && a.resolvido === false
        ).length;
        const { status, descricao } = calcularStatusDispositivo(limpo, alertasNaoResolvidos);
        return res.json({
          dispositivoId: req.params.id,
          ...limpo,
          nome: limpo.nome || limpo.modelo,
          online: calcularStatusOnline(limpo.ultimoContato),
          status,
          descricaoStatus: descricao,
          alertasNaoResolvidos,
        });
      }

      res.json(limpo);
    } catch (err) {
      console.error(`[GET /${caminho}/:id] erro:`, err);
      res.status(500).json({ erro: `Falha ao consultar ${caminho}.` });
    }
  });

  return r;
}

router.use('/dispositivos', crudSimples('dispositivos'));
router.use('/locais', crudSimples('locais'));
router.use('/usuarios', crudSimples('usuarios'));
router.use('/alertas', crudSimples('alertas'));

module.exports = router;
