# ESP32-AirSense API

API em Node.js/Express que recebe leituras de sensores (CO2, CH4, VOC, Temperatura, Umidade) enviadas por dispositivos ESP32, valida, grava no Firebase Realtime Database, agrega automaticamente em médias horárias, expira dados antigos, e disponibiliza tudo para um app/dashboard.

## Arquitetura de dados

```
dispositivos/{id}: metadados do ESP32 (modelo, datas, sensores, ativo)
leituras/{dispositivoId}/{pushId}: leituras brutas (a cada ~20s). Apagadas após a agregação horária.
leituras_horarias/{dispositivoId}/{YYYY-MM-DDTHH}: Média por tipo de sensor daquela hora. Apagadas após 7 dias (configurável).
locais/{id}: ambientes monitorados (responsável, risco)
usuarios/{id}: usuários do sistema
alertas/{pushId}: gerados automaticamente quando um valor ultrapassa o limite de segurança
```

> Importante: só a API acessa o Firebase (via Admin SDK, com `serviceAccountKey`). ESP32 e app nunca falam direto com o Firebase, simplificando muito a segurança, porque toda validação, autenticação e regra de negócio fica centralizada num único lugar que você controla. Por isso `firebase.rules.json` bloqueia qualquer acesso direto de clientes.

## Fluxo de dados

1. ESP32 envia 1 leitura a cada 20s `POST /api/leituras`.
2. A cada hora fechada (job cron, minuto 1), a API calcula a média de cada tipo de sensor das leituras daquela hora, salva em `leituras_horarias` e apaga as leituras brutas já processadas.
3. Diariamente (03:10), a API apaga registros de `leituras_horarias` com mais de 7 dias (`HOURLY_RETENTION_DAYS`).
4. O app consulta os dados via `GET`, autenticado com sua própria chave.

## Setup

```bash
cd esp32-airsense-api
npm install
cp .env.example .env
```

1. No Firebase Console > *Configurações do projeto* > *Contas de serviço* > **Gerar nova chave privada**. Isso baixa um JSON.
2. Cole o conteúdo desse JSON (minificado, em uma linha) na variável `FIREBASE_SERVICE_ACCOUNT_JSON` do `.env`, **ou** salve o arquivo como `serviceAccountKey.json` na raiz do projeto (já está no `.gitignore`).
3. Preencha `FIREBASE_DATABASE_URL` com a URL do seu Realtime Database.
4. Gere chaves fortes e aleatórias para `ESP32_API_KEY` e `APP_API_KEY` (ex.: `openssl rand -hex 32`).
5. No console do Firebase, publique o conteúdo de `firebase.rules.json` nas regras do Realtime Database.

Rodar localmente:

```bash
npm run dev
```

Rodar em produção (recomendado usar PM2 para reinício automático e logs):

```bash
npm install -g pm2
pm2 start server.js --name airsense-api
pm2 save
pm2 startup   # configura para reiniciar no boot do servidor
```

Coloque a API atrás de um proxy reverso com HTTPS (Nginx + Let's Encrypt/Certbot, ou Caddy). Nunca exponha a API diretamente em HTTP puro na internet, já que o ESP32 envia dados de sensores reais e usa uma chave estática no header.

## Múltiplos dispositivos (ESP32)

O sistema já é multi-dispositivo por natureza (tudo é indexado por `dispositivoId`), mas a autenticação agora reforça isso: **cada ESP32 tem sua própria chave de API**, gerada no provisionamento, com hash salgado (scrypt) salvo no banco, nunca em texto plano. As vantagens são:

- Revogar/trocar a chave de um dispositivo comprometido não afeta os demais.
- O rate limit (`60 req/min`) é aplicado por `dispositivoId`, não por IP — um ESP32 com bug não consome a cota de outro dispositivo atrás do mesmo roteador.
- O job de agregação horária já processa todos os dispositivos cadastrados em `/dispositivos`, um a um, coordenando a agregação/limpeza de N sensores sem intervenção manual.
- Cada leitura atualiza `dispositivos/{id}/ultimoContato` e `dispositivos/{id}/ultimaLeitura`, usados para calcular status **online/offline** (heartbeat, timeout configurável em `OFFLINE_THRESHOLD_SECONDS`, padrão 120s).

### Provisionar um novo ESP32

```bash
curl -X POST https://SEU-DOMINIO/api/admin/dispositivos \
  -H "X-Admin-Key: SUA_CHAVE_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"modelo":"ESP32-AirSense-v1","sensores":"CO2, CH4, VOC, Temperatura, Umidade"}'
```

Resposta (só aparece **uma vez** — grave no firmware imediatamente):
```json
{ "dispositivoId": "-Nabc123...", "chaveApi": "9f3a...", "aviso": "Guarde esta chave agora..." }
```

Para testes rápidos sem provisionar cada ESP32 individualmente, defina `ESP32_MASTER_KEY` no `.env` — qualquer dispositivo autenticado com essa chave é aceito (não recomendado em produção com múltiplos dispositivos reais).

## Endpoints

Todas as rotas exigem um header de autenticação.

### Dispositivo (ESP32) — header `X-Device-Key` (chave individual do dispositivo)

**POST** `/api/leituras`
```json
{
  "dispositivoId": "-Nabc123...",
  "tipo": "CO2",
  "valor": 415.2,
  "horarioLeitura": "2026-09-03T20:00:00.000Z"
}
```
`horarioLeitura` é opcional — se omitido, a API usa o horário do servidor (recomendado, evita depender do RTC do ESP32).

Tipos aceitos: `CO2`, `CH4`, `VOC`, `Temperatura`, `Umidade`. Valores fora de faixas plausíveis (ex.: CO2 negativo ou > 10000 ppm) são rejeitados com `400`.

### Admin — header `X-Admin-Key`

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/admin/dispositivos` | Provisiona um novo ESP32 e retorna sua chave (1x) |
| POST | `/api/admin/agregar-agora` | Roda a agregação horária na hora (só para testes) |
| POST | `/api/admin/purgar-agora` | Roda a purga de dados antigos na hora (só para testes) |

### App/Dashboard (Expo) — header `X-App-Key`

| Método | Rota | Descrição |
|---|---|---|
| **GET** | **`/api/resumo`** | **Visão consolidada: todos os dispositivos, última leitura de cada, status online/offline, contagem de alertas — ideal para a tela inicial do app** |
| GET | `/api/dispositivos` | Lista todos os dispositivos (sem dados de autenticação) |
| GET | `/api/dispositivos/:id` | Um dispositivo |
| GET | `/api/locais` | Lista locais monitorados |
| GET | `/api/usuarios` | Lista usuários |
| GET | `/api/alertas` | Lista alertas |
| GET | `/api/leituras/:dispositivoId` | Leituras brutas ainda não agregadas (última hora em andamento) |
| GET | `/api/leituras/:dispositivoId/horarias?dias=7` | Médias horárias, opcionalmente filtradas pelos últimos N dias |

`GET /health` não exige autenticação — use para monitorar se o processo está de pé (útil para uptime monitors externos).

## Integração com o app Expo (React Native)

Guarde a `APP_API_KEY` com `expo-secure-store` (não em `AsyncStorage` puro, que não é criptografado):

```bash
npx expo install expo-secure-store
```

```ts
// api.ts
import * as SecureStore from 'expo-secure-store';

const BASE_URL = 'https://SEU-DOMINIO/api';

async function apiFetch(path: string) {
  const appKey = await SecureStore.getItemAsync('APP_API_KEY');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-App-Key': appKey ?? '' },
  });
  if (!res.ok) throw new Error(`Erro ${res.status}: ${(await res.json()).erro}`);
  return res.json();
}

// Tela inicial: um único fetch traz tudo que o dashboard precisa
export const getResumo = () => apiFetch('/resumo');

// Gráfico de um dispositivo específico, últimos 7 dias
export const getMediasHorarias = (dispositivoId: string, dias = 7) =>
  apiFetch(`/leituras/${dispositivoId}/horarias?dias=${dias}`);

export const getAlertas = () => apiFetch('/alertas');
```

```tsx
// HomeScreen.tsx (exemplo com polling simples a cada 30s)
import { useEffect, useState } from 'react';
import { getResumo } from './api';

export default function HomeScreen() {
  const [resumo, setResumo] = useState(null);

  useEffect(() => {
    const carregar = () => getResumo().then(setResumo).catch(console.error);
    carregar();
    const intervalo = setInterval(carregar, 30000);
    return () => clearInterval(intervalo);
  }, []);

  // resumo.dispositivos → [{ dispositivoId, modelo, online, ultimaLeitura, alertasNaoResolvidos, ... }]
  return null; // renderize sua UI aqui
}
```

Por que `/api/resumo` e não várias chamadas soltas: no Expo (rede móvel, às vezes instável) cada requisição HTTP tem overhead de latência perceptível. Um único endpoint que já devolve status + última leitura + alertas de todos os dispositivos reduz isso a 1 round-trip na abertura da tela, com refresh por polling ou pull-to-refresh — simples de implementar e sem depender de WebSocket/infra extra. Se no futuro quiser dados em tempo real "empurrados" (sem polling), a evolução natural é adicionar Socket.io ao servidor e `socket.io-client` no Expo — hoje não incluído para manter a API simples de rodar em qualquer host.

## Exemplo de firmware ESP32 (C++, resumido)

```cpp
HTTPClient http;
http.begin("https://SEU-DOMINIO/api/leituras");
http.addHeader("Content-Type", "application/json");
http.addHeader("X-Device-Key", "SUA_CHAVE_ESP32");

String body = "{\"dispositivoId\":\"1\",\"tipo\":\"CO2\",\"valor\":" + String(valorCO2) + "}";
int httpCode = http.POST(body);
http.end();
```
Envie uma requisição separada por leitura de sensor (uma para CO2, uma para CH4, etc.) a cada ciclo de 20s.

## Segurança implementada

- `helmet` (headers HTTP seguros), `cors` restringível por origem, `express-rate-limit` por rota.
- Chaves de API distintas para dispositivo e app, comparadas com `crypto.timingSafeEqual` (evita timing attack).
- Validação estrita de payload (Joi) + faixas físicas plausíveis por tipo de sensor.
- Credenciais do Firebase nunca hardcoded — via variável de ambiente ou arquivo ignorado pelo git.
- Realtime Database com regras fechadas: só a API (Admin SDK) acessa os dados.
- Limite de tamanho de payload (100kb) contra abuso.

## Robustez para operação contínua (+24h)

- `unhandledRejection`/`uncaughtException` são capturados e logados em vez de derrubar o processo.
- Encerramento gracioso em `SIGTERM`/`SIGINT` (compatível com Docker/systemd/PM2).
- Recomenda-se rodar sob **PM2** (ou systemd) com `--max-memory-restart` e reinício automático, e configurar `pm2 startup` para sobreviver a reboots do servidor.
- Os jobs de agregação/purga rodam via `node-cron` dentro do próprio processo — como o job de agregação roda de hora em hora, mesmo que o processo reinicie ocasionalmente, o atraso máximo de agregação é de ~1h, sem perda de dados (as leituras brutas continuam no banco até serem processadas).

## Guia de testes

Veja `GUIA_DE_TESTES.md` (na raiz deste repositório) para um passo a passo completo de como testar a API já hospedada na nuvem — provisionar dispositivo, enviar leituras, forçar agregação/purga sob demanda, conferir alertas e testar o app Expo.

## Possíveis evoluções

- Trocar chave estática por Firebase Auth + Custom Claims (`admin: true`) para o app, com verificação de ID Token — mais seguro que chave fixa se o app tiver múltiplos usuários com permissões diferentes.
- Vincular `locais` a `dispositivos` explicitamente (hoje o JSON de exemplo não tem essa referência) para que alertas por local funcionem automaticamente.
- Mover a agregação para **Cloud Functions do Firebase** (Scheduled Functions) se preferir não depender de um processo Node.js sempre ativo.
- Adicionar testes automatizados (Jest + `firebase-admin` mockado) antes de ir para produção.
