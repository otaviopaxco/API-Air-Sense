const { db } = require('../config/firebase');
const { registrarContato } = require('./deviceService');
const { notificarAlerta } = require('./notificationService');

// Limiares simples para geração automática de alertas (ppm/°C/%).
// Ajuste conforme a norma/realidade de cada tipo de ambiente monitorado.
const LIMIARES_ALERTA = {
  CO2: 5000, // ppm — exposição ocupacional (referência aproximada, ajuste conforme NR-15/normas locais)
  CH4: 10000, // ppm — bem abaixo do LEL (~50000 ppm), margem de segurança
  VOC: 20000, // ppb
  Temperatura: 45, // °C
  Umidade: 90, // %
};

/**
 * Grava uma leitura bruta em /leituras/{dispositivoId}/{pushId}
 * e atualiza /dispositivos/{dispositivoId}/dataServico (heartbeat).
 */
async function gravarLeitura({ dispositivoId, valor, tipo, horarioLeitura }) {
  const timestamp = horarioLeitura || new Date().toISOString();

  const novaLeituraRef = db.ref(`leituras/${dispositivoId}`).push();
  await novaLeituraRef.set({
    valor,
    tipo,
    horarioLeitura: timestamp,
  });

  // Heartbeat + espelho da última leitura por tipo, para o endpoint /resumo
  // não precisar varrer todas as leituras brutas do dispositivo.
  await registrarContato(dispositivoId, { tipo, valor, horario: timestamp });

  if (valor >= (LIMIARES_ALERTA[tipo] ?? Infinity)) {
    await criarAlerta({ dispositivoId, tipo, valor, timestamp });
  }

  return { id: novaLeituraRef.key, timestamp };
}

/**
 * Cria um alerta, mas evita duplicar: se já existe um alerta NÃO resolvido
 * do mesmo tipo para o mesmo dispositivo, apenas atualiza o valor/horário
 * dele (senão cada leitura acima do limite, a cada ~20s, geraria um novo
 * alerta e um novo push). A notificação só é disparada na transição
 * "sem alerta" -> "alerta ativo".
 */
async function criarAlerta({ dispositivoId, tipo, valor, timestamp }) {
  const existentesSnap = await db
    .ref('alertas')
    .orderByChild('dispositivoId')
    .equalTo(dispositivoId)
    .once('value');
  const existentes = existentesSnap.val() || {};

  const alertaAtivoExistente = Object.entries(existentes).find(
    ([, a]) => a.tipo === tipo && a.resolvido === false
  );

  if (alertaAtivoExistente) {
    const [alertaId] = alertaAtivoExistente;
    await db.ref(`alertas/${alertaId}`).update({ valorMedido: valor, horario: timestamp });
    return alertaId;
  }

  const alertaRef = db.ref('alertas').push();
  await alertaRef.set({
    dispositivoId,
    tipo,
    valorMedido: valor,
    limite: LIMIARES_ALERTA[tipo] ?? null,
    descricao: `Nível de ${tipo} acima do limite seguro (${valor}) no dispositivo ${dispositivoId}`,
    risco: 6,
    horario: timestamp,
    resolvido: false,
  });

  // Dispara push de forma assíncrona (não bloqueia a resposta ao ESP32
  // nem falha a gravação da leitura caso o envio dê erro).
  db.ref(`dispositivos/${dispositivoId}`)
    .once('value')
    .then((snap) => {
      const nomeDispositivo = snap.val()?.nome || snap.val()?.modelo;
      return notificarAlerta({ dispositivoId, nomeDispositivo, tipo, valorMedido: valor });
    })
    .catch((err) => console.error('[push] falha ao notificar alerta:', err));

  return alertaRef.key;
}

/**
 * Tenta dispensar um alerta. Só é permitido se as últimas 5 amostras
 * (leituras brutas mais médias horárias como complemento, mais recentes
 * primeiro) daquele tipo de sensor no dispositivo estiverem dentro do
 * limite seguro. Caso contrário, o alerta continua ativo e a função
 * retorna `permitido: false`.
 */
async function dispensarAlerta(alertaId) {
  const alertaSnap = await db.ref(`alertas/${alertaId}`).once('value');
  const alerta = alertaSnap.val();
  if (!alerta) return { encontrado: false };
  if (alerta.resolvido) return { encontrado: true, permitido: true, jaResolvido: true };

  const { dispositivoId, tipo } = alerta;
  const limite = LIMIARES_ALERTA[tipo] ?? Infinity;

  // Leituras brutas ainda não agregadas (última hora em andamento).
  const leiturasSnap = await db.ref(`leituras/${dispositivoId}`).once('value');
  const amostras = Object.values(leiturasSnap.val() || {})
    .filter((l) => l.tipo === tipo)
    .sort((a, b) => new Date(b.horarioLeitura) - new Date(a.horarioLeitura))
    .slice(0, 5)
    .map((l) => ({ valor: l.valor }));

  // Complemento: se faltam leituras brutas (ex.: o job de agregação horária
  // acabou de rodar — minuto 1 de cada hora — e apagou as leituras já
  // processadas), usa as médias horárias mais recentes já calculadas em
  // vez de bloquear a dispensa só por causa do momento em que o usuário
  // tentou (o sensor pode já estar normal há muito tempo).
  if (amostras.length < 5) {
    const horariasSnap = await db.ref(`leituras_horarias/${dispositivoId}`).once('value');
    const mediasHorarias = Object.entries(horariasSnap.val() || {})
      .filter(([, h]) => typeof h[tipo] === 'number')
      .sort(([hourKeyA], [hourKeyB]) => hourKeyB.localeCompare(hourKeyA)) // "YYYY-MM-DDTHH" ordena cronologicamente como string
      .map(([, h]) => ({ valor: h[tipo] }));

    for (const media of mediasHorarias) {
      if (amostras.length >= 5) break;
      amostras.push(media);
    }
  }

  if (amostras.length < 5) {
    return {
      encontrado: true,
      permitido: false,
      motivo: `Ainda não há 5 leituras/médias recentes de ${tipo} para confirmar a normalização (${amostras.length}/5).`,
    };
  }

  const todasNormais = amostras.every((a) => a.valor < limite);
  if (!todasNormais) {
    return {
      encontrado: true,
      permitido: false,
      motivo: `Ainda há leituras de ${tipo} acima do limite seguro nas últimas amostras.`,
    };
  }

  await db.ref(`alertas/${alertaId}`).update({
    resolvido: true,
    resolvidoEm: new Date().toISOString(),
  });

  return { encontrado: true, permitido: true };
}

/**
 * Para cada dispositivo, agrega as leituras da última hora completa em
 * /leituras_horarias/{dispositivoId}/{hourKey}, com a média por tipo de
 * sensor, e então apaga as leituras brutas já processadas.
 */
async function agregarLeiturasDaUltimaHora() {
  const agora = new Date();
  // Hora fechada anterior: se agora são 14:07, processamos 13:00–14:00.
  const fimHora = new Date(agora);
  fimHora.setMinutes(0, 0, 0);
  const inicioHora = new Date(fimHora.getTime() - 60 * 60 * 1000);
  const hourKey = inicioHora.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"

  const dispositivosSnap = await db.ref('dispositivos').once('value');
  const dispositivos = dispositivosSnap.val() || {};
  const resultados = [];

  for (const dispositivoId of Object.keys(dispositivos)) {
    const leiturasSnap = await db.ref(`leituras/${dispositivoId}`).once('value');
    const leituras = leiturasSnap.val() || {};

    const somaPorTipo = {};
    const contPorTipo = {};
    const idsParaApagar = [];

    for (const [leituraId, leitura] of Object.entries(leituras)) {
      const dataLeitura = new Date(leitura.horarioLeitura);
      if (dataLeitura >= inicioHora && dataLeitura < fimHora) {
        somaPorTipo[leitura.tipo] = (somaPorTipo[leitura.tipo] || 0) + leitura.valor;
        contPorTipo[leitura.tipo] = (contPorTipo[leitura.tipo] || 0) + 1;
        idsParaApagar.push(leituraId);
      }
    }

    if (idsParaApagar.length === 0) continue; // nada a agregar nesta hora

    const medias = {};
    for (const tipo of Object.keys(somaPorTipo)) {
      medias[tipo] = Number((somaPorTipo[tipo] / contPorTipo[tipo]).toFixed(2));
    }

    await db.ref(`leituras_horarias/${dispositivoId}/${hourKey}`).set({
      ...medias,
      amostras: idsParaApagar.length,
      timestampInicio: inicioHora.toISOString(),
      timestampFim: fimHora.toISOString(),
    });

    // Apaga apenas as leituras brutas já processadas (evita corrida com
    // leituras novas que possam chegar durante a execução do job).
    const updates = {};
    idsParaApagar.forEach((id) => {
      updates[`leituras/${dispositivoId}/${id}`] = null;
    });
    await db.ref().update(updates);

    resultados.push({ dispositivoId, hourKey, amostras: idsParaApagar.length, medias });
  }

  return resultados;
}

/**
 * Apaga médias horárias com mais de N dias (padrão 7) em
 * /leituras_horarias/{dispositivoId}/{hourKey}.
 */
async function purgarLeiturasHorariasAntigas(diasRetencao = 7) {
  const limite = new Date(Date.now() - diasRetencao * 24 * 60 * 60 * 1000);

  const snap = await db.ref('leituras_horarias').once('value');
  const dados = snap.val() || {};
  const updates = {};
  let apagados = 0;

  for (const [dispositivoId, horas] of Object.entries(dados)) {
    for (const hourKey of Object.keys(horas)) {
      // hourKey = "YYYY-MM-DDTHH"
      const dataHora = new Date(`${hourKey}:00:00.000Z`);
      if (dataHora < limite) {
        updates[`leituras_horarias/${dispositivoId}/${hourKey}`] = null;
        apagados += 1;
      }
    }
  }

  if (apagados > 0) {
    await db.ref().update(updates);
  }

  return { apagados };
}

/**
 * Remove alertas já dispensados (resolvido = true) há mais de 7 dias.
 * Alertas ainda ativos nunca são apagados por aqui, só quando dispensados.
 */
async function purgarAlertasResolvidosAntigos() {
  const LIMITE_DIAS = 7;
  const limite = new Date(Date.now() - LIMITE_DIAS * 24 * 60 * 60 * 1000);

  const snap = await db.ref('alertas').once('value');
  const alertas = snap.val() || {};
  const updates = {};
  let apagados = 0;

  for (const [id, alerta] of Object.entries(alertas)) {
    if (alerta.resolvido && alerta.resolvidoEm && new Date(alerta.resolvidoEm) < limite) {
      updates[`alertas/${id}`] = null;
      apagados += 1;
    }
  }

  if (apagados > 0) {
    await db.ref().update(updates);
  }

  return { apagados };
}

module.exports = {
  gravarLeitura,
  criarAlerta,
  dispensarAlerta,
  agregarLeiturasDaUltimaHora,
  purgarLeiturasHorariasAntigas,
  purgarAlertasResolvidosAntigos,
};
