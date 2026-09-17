const { db } = require('../config/firebase');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Coleta os Expo Push Tokens de todos os usuários cadastrados em /usuarios.
 * Tokens são salvos pelo app em usuarios/{uid}/pushTokens/{token} = true
 * (um usuário pode ter mais de um dispositivo/celular logado).
 */
async function coletarPushTokens() {
  const snap = await db.ref('usuarios').once('value');
  const usuarios = snap.val() || {};
  const tokens = new Set();

  for (const usuario of Object.values(usuarios)) {
    if (usuario?.pushTokens) {
      Object.keys(usuario.pushTokens).forEach((t) => tokens.add(t));
    }
  }

  return Array.from(tokens);
}

/**
 * Envia uma notificação push via Expo Push API para uma lista de tokens.
 * Usa fetch nativo do Node 18+. Falhas de envio são logadas, mas nunca
 * derrubam o fluxo principal (gravação de leitura/alerta já foi concluída).
 */
async function enviarPush(tokens, { titulo, corpo, dados }) {
  if (!tokens || tokens.length === 0) return;

  const mensagens = tokens
    .filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'))
    .map((to) => ({
      to,
      sound: 'default',
      title: titulo,
      body: corpo,
      data: dados || {},
      priority: 'high',
      channelId: 'alertas',
    }));

  if (mensagens.length === 0) return;

  try {
    const resposta = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mensagens),
    });

    if (!resposta.ok) {
      console.error('[push] Expo respondeu com erro HTTP', resposta.status, await resposta.text());
      return;
    }

    const json = await resposta.json();
    const erros = (json?.data || []).filter((r) => r.status === 'error');
    if (erros.length > 0) {
      console.error('[push] erros retornados pela Expo:', erros);
    }
  } catch (err) {
    console.error('[push] falha ao chamar Expo Push API:', err);
  }
}

/**
 * Notifica todos os usuários cadastrados sobre um novo alerta.
 */
async function notificarAlerta({ dispositivoId, nomeDispositivo, tipo, valorMedido }) {
  const tokens = await coletarPushTokens();
  await enviarPush(tokens, {
    titulo: `Alerta em ${nomeDispositivo || dispositivoId}`,
    corpo: `${tipo} acima do limite seguro (${valorMedido}).`,
    dados: { tipo: 'alerta', dispositivoId },
  });
}

async function registrarPushToken(usuarioId, token) {
  if (!usuarioId || !token) return;
  await db.ref(`usuarios/${usuarioId}/pushTokens/${token}`).set(true);
}

async function removerPushToken(usuarioId, token) {
  if (!usuarioId || !token) return;
  await db.ref(`usuarios/${usuarioId}/pushTokens/${token}`).remove();
}

module.exports = { notificarAlerta, registrarPushToken, removerPushToken };
