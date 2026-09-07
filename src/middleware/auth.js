const crypto = require('crypto');
const { validarChaveDispositivo } = require('../services/deviceService');

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Autentica o ESP32 verificando a chave individual do dispositivo
 * (armazenada com hash em /dispositivos/{id}/auth). Cada dispositivo tem
 * sua própria chave — revogar/trocar uma não afeta os demais.
 *
 * Modo de compatibilidade: se ESP32_MASTER_KEY estiver definida no .env e
 * o header bater com ela, libera qualquer dispositivo (útil só para testes
 * rápidos — não recomendado em produção com múltiplos dispositivos).
 */
async function authenticateDevice(req, res, next) {
  const chave = req.header('X-Device-Key');
  const dispositivoId = req.body?.dispositivoId;

  if (!chave || !dispositivoId) {
    return res.status(400).json({ erro: 'dispositivoId (corpo) e X-Device-Key (header) são obrigatórios.' });
  }

  if (process.env.ESP32_MASTER_KEY && timingSafeEqualStr(chave, process.env.ESP32_MASTER_KEY)) {
    console.warn(`[auth] Dispositivo ${dispositivoId} autenticado via chave mestra (modo de teste).`);
    return next();
  }

  try {
    const dispositivo = await validarChaveDispositivo(dispositivoId, chave);
    if (!dispositivo) {
      return res.status(401).json({ erro: 'Dispositivo desconhecido, inativo ou chave inválida.' });
    }
    req.dispositivo = dispositivo;
    next();
  } catch (err) {
    console.error('[auth] erro ao validar dispositivo:', err);
    res.status(500).json({ erro: 'Falha ao validar autenticação do dispositivo.' });
  }
}

function authenticateApp(req, res, next) {
  const key = req.header('X-App-Key');
  if (!key || !process.env.APP_API_KEY || !timingSafeEqualStr(key, process.env.APP_API_KEY)) {
    return res.status(401).json({ erro: 'Chave de aplicativo ausente ou inválida.' });
  }
  next();
}

/**
 * Protege rotas administrativas (ex.: provisionar novo dispositivo).
 * Use uma chave separada das demais e restrinja quem a possui.
 */
function authenticateAdmin(req, res, next) {
  const key = req.header('X-Admin-Key');
  if (!key || !process.env.ADMIN_API_KEY || !timingSafeEqualStr(key, process.env.ADMIN_API_KEY)) {
    return res.status(401).json({ erro: 'Chave administrativa ausente ou inválida.' });
  }
  next();
}

module.exports = { authenticateDevice, authenticateApp, authenticateAdmin };
