const crypto = require('crypto');
const { db } = require('../config/firebase');

const OFFLINE_THRESHOLD_MS = (Number(process.env.OFFLINE_THRESHOLD_SECONDS) || 120) * 1000;

function gerarChaveDispositivo() {
  return crypto.randomBytes(24).toString('hex'); // chave em texto plano, entregue 1x ao provisionar
}

function hashChave(chave, salt) {
  return crypto.scryptSync(chave, salt, 64).toString('hex');
}

/**
 * Cria um novo dispositivo em /dispositivos/{id} com uma chave de API única.
 * A chave em texto plano é retornada apenas nesta chamada — só o hash+salt
 * ficam salvos no banco. Grave a chave no firmware do ESP32 imediatamente.
 */
async function provisionarDispositivo({ modelo, sensores, id }) {
  const dispositivoId = id || (await db.ref('dispositivos').push()).key;
  const chave = gerarChaveDispositivo();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashChave(chave, salt);
  const agora = new Date().toISOString();

  await db.ref(`dispositivos/${dispositivoId}`).set({
    modelo: modelo || 'ESP32-AirSense-v1',
    dataInstalacao: agora.slice(0, 10),
    dataServico: agora.slice(0, 10),
    sensores: sensores || 'CO2, CH4, VOC, Temperatura, Umidade',
    ativo: true,
    ultimoContato: null,
    auth: { salt, hash },
  });

  return { dispositivoId, chaveApi: chave };
}

/**
 * Verifica se a chave enviada pelo header X-Device-Key corresponde ao
 * dispositivo informado no corpo da requisição. Retorna o snapshot do
 * dispositivo se válido, ou null caso contrário.
 */
async function validarChaveDispositivo(dispositivoId, chaveFornecida) {
  if (!dispositivoId || !chaveFornecida) return null;

  const snap = await db.ref(`dispositivos/${dispositivoId}`).once('value');
  const dispositivo = snap.val();
  if (!dispositivo || dispositivo.ativo === false || !dispositivo.auth) return null;

  const hashCalculado = hashChave(chaveFornecida, dispositivo.auth.salt);
  const bufA = Buffer.from(hashCalculado, 'hex');
  const bufB = Buffer.from(dispositivo.auth.hash, 'hex');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;

  return dispositivo;
}

/**
 * Atualiza o heartbeat do dispositivo (chamado a cada leitura recebida).
 */
async function registrarContato(dispositivoId, dadosLeitura) {
  const agora = new Date().toISOString();
  const updates = {
    ultimoContato: agora,
    dataServico: agora.slice(0, 10),
  };
  if (dadosLeitura) {
    updates[`ultimaLeitura/${dadosLeitura.tipo}`] = {
      valor: dadosLeitura.valor,
      horario: dadosLeitura.horario,
    };
  }
  await db.ref(`dispositivos/${dispositivoId}`).update(updates);
}

function calcularStatusOnline(ultimoContato) {
  if (!ultimoContato) return false;
  return Date.now() - new Date(ultimoContato).getTime() <= OFFLINE_THRESHOLD_MS;
}

module.exports = {
  provisionarDispositivo,
  validarChaveDispositivo,
  registrarContato,
  calcularStatusOnline,
  OFFLINE_THRESHOLD_MS,
};
