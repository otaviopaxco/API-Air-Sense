# Guia de testes — ESP32-AirSense API na nuvem

Assume que a API já está publicada em `https://SEU-DOMINIO` (com HTTPS válido, atrás de um proxy reverso). Troque `SEU-DOMINIO`, `ADMIN_KEY`, `APP_KEY` etc. pelos valores reais do seu `.env` em todos os comandos abaixo. Os exemplos usam `curl`, mas funcionam igual no Postman/Insomnia.

## 0. A API está de pé?

```bash
curl https://SEU-DOMINIO/health
```
Esperado: `{"status":"ok","uptime":...,"timestamp":"..."}`. Se der timeout/erro de conexão, o problema é infraestrutura (deploy, DNS, firewall) — resolva isso antes de seguir.

## 1. Provisionar um dispositivo de teste

```bash
curl -X POST https://SEU-DOMINIO/api/admin/dispositivos \
  -H "X-Admin-Key: ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"modelo":"ESP32-AirSense-v2","sensores":"CO2, CH4, VOC, Temperatura, Umidade"}'
```

Resposta esperada (`201`):
```json
{ "dispositivoId": "-Nabc123xyz", "chaveApi": "9f3a7e...", "aviso": "Guarde esta chave agora..." }
```

**Guarde os dois valores** — vai precisar deles nos próximos passos (e são os mesmos que vão para `DISPOSITIVO_ID` e `CHAVE_DISPOSITIVO` no firmware).

Teste negativo — sem a chave admin, deve dar `401`:
```bash
curl -X POST https://SEU-DOMINIO/api/admin/dispositivos -H "Content-Type: application/json" -d '{}'
```

## 2. Simular o ESP32 enviando leituras

Substitua `DISP_ID` e `DEV_KEY` pelos valores do passo 1:

```bash
curl -X POST https://SEU-DOMINIO/api/leituras \
  -H "X-Device-Key: DEV_KEY" -H "Content-Type: application/json" \
  -d '{"dispositivoId":"DISP_ID","tipo":"CO2","valor":420}'

curl -X POST https://SEU-DOMINIO/api/leituras \
  -H "X-Device-Key: DEV_KEY" -H "Content-Type: application/json" \
  -d '{"dispositivoId":"DISP_ID","tipo":"VOC","valor":150}'

curl -X POST https://SEU-DOMINIO/api/leituras \
  -H "X-Device-Key: DEV_KEY" -H "Content-Type: application/json" \
  -d '{"dispositivoId":"DISP_ID","tipo":"Temperatura","valor":24.5}'

curl -X POST https://SEU-DOMINIO/api/leituras \
  -H "X-Device-Key: DEV_KEY" -H "Content-Type: application/json" \
  -d '{"dispositivoId":"DISP_ID","tipo":"Umidade","valor":55}'

curl -X POST https://SEU-DOMINIO/api/leituras \
  -H "X-Device-Key: DEV_KEY" -H "Content-Type: application/json" \
  -d '{"dispositivoId":"DISP_ID","tipo":"CH4","valor":300}'
```

Cada uma deve responder `201` com `{"ok":true,"id":"...","horarioLeitura":"..."}`.

Testes negativos que valem a pena rodar:
- Chave de dispositivo errada → `401`.
- `"tipo":"Pressao"` (tipo inexistente) → `400` com detalhe do erro de validação.
- `"valor":99999` para CO2 (fora da faixa plausível 0–10000 ppm) → `400`.
- Repita a mesma requisição válida ~60x em menos de 1 min → a partir da 61ª deve vir `429` (rate limit por dispositivo).

## 3. Testar geração automática de alerta

Envie um valor acima do limiar configurado em `firebaseService.js` (padrão: CO2 ≥ 5000 ppm):
```bash
curl -X POST https://SEU-DOMINIO/api/leituras \
  -H "X-Device-Key: DEV_KEY" -H "Content-Type: application/json" \
  -d '{"dispositivoId":"DISP_ID","tipo":"CO2","valor":5200}'
```
Depois confira se o alerta foi criado (passo 6 abaixo mostra como consultar `/api/alertas`).

## 4. Conferir as leituras brutas gravadas

```bash
curl https://SEU-DOMINIO/api/leituras/DISP_ID -H "X-App-Key: APP_KEY"
```
Deve listar todas as leituras que você acabou de enviar, com seus `pushId` gerados pelo Firebase.

## 5. Forçar a agregação horária (sem esperar 1h)

Em produção esse job roda sozinho a cada hora — mas pra testar agora:
```bash
curl -X POST https://SEU-DOMINIO/api/admin/agregar-agora -H "X-Admin-Key: ADMIN_KEY"
```
Resposta esperada:
```json
{ "ok": true, "dispositivosProcessados": 1, "detalhes": [{ "dispositivoId": "DISP_ID", "hourKey": "...", "amostras": 5, "medias": { "CO2": 420, "VOC": 150, "Temperatura": 24.5, "Umidade": 55, "CH4": 300 } }] }
```
> Nota: o job agrega a **última hora fechada**, não a hora corrente. Se você acabou de enviar as leituras no minuto atual, rode este comando de novo depois que o relógio virar a hora cheia — ou simplesmente confirme no passo 4 que as leituras já não aparecem mais em `/api/leituras/DISP_ID` (sinal de que foram processadas e movidas).

Confira o resultado:
```bash
curl "https://SEU-DOMINIO/api/leituras/DISP_ID/horarias" -H "X-App-Key: APP_KEY"
```

## 6. Conferir o resumo (o que o app Expo vai consumir)

```bash
curl https://SEU-DOMINIO/api/resumo -H "X-App-Key: APP_KEY"
```
Deve trazer o dispositivo com `online: true` (heartbeat recente), `ultimaLeitura` preenchida por tipo, e `alertasNaoResolvidos` contando o alerta gerado no passo 3.

```bash
curl https://SEU-DOMINIO/api/alertas -H "X-App-Key: APP_KEY"
```

## 7. Testar o status online/offline

Pare de enviar leituras para o `DISP_ID` e espere mais que `OFFLINE_THRESHOLD_SECONDS` (padrão 120s). Consulte `/api/resumo` de novo — o dispositivo deve aparecer com `"online": false`.

## 8. Testar a purga de dados antigos

```bash
curl -X POST https://SEU-DOMINIO/api/admin/purgar-agora \
  -H "X-Admin-Key: ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"dias":0}'
```
Usar `"dias":0` força a purga de tudo (útil só para testar que o mecanismo funciona). Confira com o comando do passo 5 que `leituras_horarias/DISP_ID` esvaziou.

## 9. Testar com o ESP32 físico

1. Grave `DISPOSITIVO_ID` e `CHAVE_DISPOSITIVO` (do passo 1) no firmware, junto com o WiFi e `API_URL_LEITURAS = "https://SEU-DOMINIO/api/leituras"`.
2. Suba o firmware e abra o Monitor Serial (115200 baud).
3. Confirme no serial: `WiFi conectado`, depois a cada 20s uma linha `OK [tipo] -> HTTP 201` para cada um dos 5 tipos.
4. Em paralelo, rode `curl https://SEU-DOMINIO/api/resumo -H "X-App-Key: APP_KEY"` e veja `ultimaLeitura` mudando a cada ciclo.
5. Cubra o MQ-4 ou sopre no ENS160 para simular uma leitura alta e confira: LED vermelho acende localmente **e** um alerta aparece em `/api/alertas` dentro de alguns segundos.

## 10. Testar do app Expo

Com `EXPO_PUBLIC_API_URL` (ou similar) apontando para `https://SEU-DOMINIO/api` e a `APP_KEY` salva via `expo-secure-store`, chame `getResumo()` (ver exemplo no `README.md`) e confirme que os mesmos dados do passo 6 aparecem na tela do app.

---

### Checklist rápido de "está tudo funcionando"
- [ ] `/health` responde 200
- [ ] Provisionamento de dispositivo funciona e nega sem `X-Admin-Key`
- [ ] Envio de leitura válida → 201; inválida → 400; chave errada → 401
- [ ] Alerta é criado automaticamente ao passar do limiar
- [ ] Agregação horária move dados de `leituras` para `leituras_horarias` e limpa os brutos
- [ ] `/api/resumo` reflete a última leitura e o status online/offline corretamente
- [ ] Purga remove registros horários antigos
- [ ] ESP32 físico consegue enviar e aparece em tempo real no `/api/resumo`
- [ ] App Expo consegue ler `/api/resumo` com a `APP_KEY`
