const express = require('express');
const router = express.Router();

const { db } = require('../config/firebase');
const { authenticateApp } = require('../middleware/auth');
const { appLimiter } = require('../middleware/rateLimiter');

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
      const snap = await db.ref(`${caminho}/${req.params.id}`).once('value');
      if (!snap.exists()) return res.status(404).json({ erro: 'Não encontrado.' });
      res.json(removerCamposOcultos(caminho, snap.val()));
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
