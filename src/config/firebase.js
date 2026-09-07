const admin = require('firebase-admin');

let serviceAccount;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    // Alternativa: caminho para um arquivo local (não versionar!)
    serviceAccount = require('../../serviceAccountKey.json');
  }
} catch (err) {
  console.error('[firebase] Falha ao carregar credenciais da service account.');
  console.error('Defina FIREBASE_SERVICE_ACCOUNT_JSON no .env ou forneça serviceAccountKey.json');
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
