require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const leiturasRouter = require('./src/routes/leituras');
const recursosRouter = require('./src/routes/recursos');
const resumoRouter = require('./src/routes/resumo');
const adminRouter = require('./src/routes/admin');
const { iniciarJobs } = require('./src/jobs/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Segurança e infraestrutura básica ---
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: '100kb' })); // payloads de sensor são pequenos
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Restrinja em produção à origem real do seu app/dashboard.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
  })
);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use('/api/leituras', leiturasRouter);
app.use('/api/resumo', resumoRouter);
app.use('/api/admin', adminRouter);
app.use('/api', recursosRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// Handler de erro genérico (evita vazar stack trace em produção)
app.use((err, req, res, next) => {
  console.error('[erro não tratado]', err);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

const server = app.listen(PORT, () => {
  console.log(`API ESP32-AirSense rodando na porta ${PORT} (${process.env.NODE_ENV || 'development'})`);
  iniciarJobs();
});

// --- Robustez para operação contínua (+24h) ---
// Evita que uma promise rejeitada sem catch, ou uma exceção síncrona,
// derrube o processo silenciosamente. Preferimos logar e continuar
// (o processo deve ficar de pé; use um supervisor como PM2/systemd
// para reiniciar automaticamente em caso de erro fatal real).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

function encerrarComGraca(sinal) {
  console.log(`[shutdown] Sinal ${sinal} recebido, encerrando servidor...`);
  server.close(() => {
    console.log('[shutdown] Servidor encerrado.');
    process.exit(0);
  });
  // Força saída se não fechar em 10s
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => encerrarComGraca('SIGTERM'));
process.on('SIGINT', () => encerrarComGraca('SIGINT'));

module.exports = app;
