const cron = require('node-cron');
const {
  agregarLeiturasDaUltimaHora,
  purgarLeiturasHorariasAntigas,
  purgarAlertasResolvidosAntigos,
} = require('../services/firebaseService');

function iniciarJobs() {
  // Ao minuto 1 de cada hora: agrega a hora que acabou de fechar e apaga
  // as leituras brutas já processadas. O atraso de 1 min dá folga para
  // leituras que chegam com pequeno delay de rede.
  cron.schedule('1 * * * *', async () => {
    try {
      const resultado = await agregarLeiturasDaUltimaHora();
      console.log(`[job:agregacao] ${new Date().toISOString()} — ${resultado.length} dispositivo(s) processado(s).`);
    } catch (err) {
      console.error('[job:agregacao] erro:', err);
    }
  });

  // Diariamente às 03:10: apaga médias horárias com mais de N dias
  // (padrão 7, configurável via HOURLY_RETENTION_DAYS).
  cron.schedule('10 3 * * *', async () => {
    const dias = Number(process.env.HOURLY_RETENTION_DAYS) || 7;
    try {
      const { apagados } = await purgarLeiturasHorariasAntigas(dias);
      console.log(`[job:purga] ${new Date().toISOString()} — ${apagados} registro(s) horário(s) removido(s) (>${dias}d).`);
    } catch (err) {
      console.error('[job:purga] erro:', err);
    }
  });

  // Diariamente às 03:20: apaga alertas já DISPENSADOS há mais de 7 dias.
  // Alertas ainda ativos nunca são afetados por este job.
  cron.schedule('20 3 * * *', async () => {
    try {
      const { apagados } = await purgarAlertasResolvidosAntigos();
      console.log(`[job:purga-alertas] ${new Date().toISOString()} — ${apagados} alerta(s) dispensado(s) removido(s) (>7d).`);
    } catch (err) {
      console.error('[job:purga-alertas] erro:', err);
    }
  });

  console.log('[jobs] Agendamento iniciado: agregação horária (min 1), purga diária de leituras (03:10) e de alertas dispensados (03:20).');
}

module.exports = { iniciarJobs };
