const cron = require('node-cron');
const { agregarLeiturasDaUltimaHora, purgarLeiturasHorariasAntigas } = require('../services/firebaseService');

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

  console.log('[jobs] Agendamento iniciado: agregação horária (min 1) e purga diária (03:10).');
}

module.exports = { iniciarJobs };
