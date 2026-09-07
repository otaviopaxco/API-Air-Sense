const fs = require('fs');
const admin = require('firebase-admin');

let serviceAccount;

// Ordem de prioridade — a API tenta cada uma até achar as credenciais:
// 1) Secret File do Render (ou qualquer arquivo local) em CAMINHO_SERVICE_ACCOUNT
// 2) Variável de ambiente FIREBASE_SERVICE_ACCOUNT_JSON (texto em uma linha)
// 3) Arquivo serviceAccountKey.json na raiz do projeto (uso local/dev)
const CAMINHO_SERVICE_ACCOUNT = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '/etc/secrets/serviceAccountKey.json';

try {
  if (fs.existsSync(CAMINHO_SERVICE_ACCOUNT)) {
    serviceAccount = JSON.parse(fs.readFileSync(CAMINHO_SERVICE_ACCOUNT, 'utf8'));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    // Alternativa: arquivo local na raiz do projeto (não versionar!)
    serviceAccount = require('../../serviceAccountKey.json');
  }
} catch (err) {
  console.error('[firebase] Falha ao carregar credenciais da service account.');
  console.error(
    `Forneça um Secret File em ${CAMINHO_SERVICE_ACCOUNT}, defina FIREBASE_SERVICE_ACCOUNT_JSON, ou crie serviceAccountKey.json localmente.`
  );
  throw err;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.database();

module.exports = { admin, db };
