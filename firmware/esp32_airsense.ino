#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <LiquidCrystal_I2C.h>
#include <DFRobot_ENS160.h>
#include <DFRobot_AHT20.h>

// CONFIG
const char* WIFI_SSID        = "SEU_WIFI";
const char* WIFI_PASSWORD    = "SUA_SENHA";
const char* API_URL_LEITURAS = "https://SEU-DOMINIO/api/leituras"; // use https em produção

// Gerados via: curl -X POST https://SEU-DOMINIO/api/admin/dispositivos ...
const char* DISPOSITIVO_ID    = "COLE_O_ID_DO_DISPOSITIVO_AQUI";
const char* CHAVE_DISPOSITIVO = "COLE_A_CHAVE_GERADA_AQUI";

// PINOS
const int PINO_MQ4 = 34; // saída analógica do MQ-4 (metano)

// LEDs do MQ-4
const int LED_VERMELHO_MQ4 = 27;
const int LED_VERDE_MQ4    = 14;

// LEDs do ENS160/AHT21 compartilhados entre CO2, temperatura e umidade:
const int LED_VERMELHO_ENS160 = 16;
const int LED_VERDE_ENS160    = 4;

// Endereços I2C, troque se o scanner I2C indicar outro endereço no seu módulo
#define ENDERECO_LCD    0x27
#define ENDERECO_ENS160 0x53

LiquidCrystal_I2C lcd(ENDERECO_LCD, 16, 2);
DFRobot_ENS160_I2C ens160(&Wire, ENDERECO_ENS160);
DFRobot_AHT20 aht20;

// LIMITES DE ALERTA (locais)
// Estes são limites de referência para o LED/LCD locais. Os limites de segurança usados pela API para gerar alertas no servidor são configurados separadamente em src/services/firebaseService.js.
const float CH4_LIMITE_PCT    = 92.0;   // % do range do MQ-4 (~1000 ppm)
const uint16_t CO2_LIMITE_PPM = 1500;   // eCO2 — acima disso, ventilação já é recomendada.
const float TEMP_LIMITE_C     = 45.0;
const float UMIDADE_LIMITE_PCT = 90.0;

// TEMPORIZAÇÃO
unsigned long ultimaLeituraLocal = 0;
unsigned long ultimoEnvioAPI = 0;
const unsigned long INTERVALO_LOCAL_MS = 2000;   // atualiza LCD/LEDs a cada 2s (resposta rápida)
const unsigned long INTERVALO_API_MS   = 20000;  // envia para a API a cada 20s

// Calibração do MQ-4
const int limiteMin = 819;
const int limiteMax = 4015;
const float PPM_POR_PERCENTUAL = 1000.0 / 92.0; // estimativa linear com calibre com o datasheet do MQ-4 para precisão real

// VALORES CACHEADOS (última leitura válida)
float gCh4Pct = 0, gCh4Ppm = 0;
float gTemperatura = 0, gUmidade = 0;
uint16_t gCO2 = 0, gTVOC = 0;
bool gENS160ok = false;
bool gAHT20ok = false;

int idLeitura = 0;
bool telaAlternada = false;

void setup() {
  Serial.begin(115200);
  Wire.begin(); // SDA=21, SCL=22 por padrão no ESP32

  pinMode(LED_VERMELHO_MQ4, OUTPUT);
  pinMode(LED_VERDE_MQ4, OUTPUT);
  pinMode(LED_VERMELHO_ENS160, OUTPUT);
  pinMode(LED_VERDE_ENS160, OUTPUT);
  digitalWrite(LED_VERMELHO_MQ4, LOW);
  digitalWrite(LED_VERDE_MQ4, LOW);
  digitalWrite(LED_VERMELHO_ENS160, LOW);
  digitalWrite(LED_VERDE_ENS160, LOW);

  lcd.init();
  lcd.backlight();
  lcd.print("ESP32-AirSense");
  lcd.setCursor(0, 1);
  lcd.print("Iniciando...");

  iniciarSensores();
  conectarWiFi();

  lcd.clear();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    conectarWiFi();
  }

  if (millis() - ultimaLeituraLocal >= INTERVALO_LOCAL_MS) {
    ultimaLeituraLocal = millis();
    lerSensoresLocais();
    atualizarLeds();
    atualizarLCD();
  }

  if (millis() - ultimoEnvioAPI >= INTERVALO_API_MS) {
    ultimoEnvioAPI = millis();
    idLeitura++;
    Serial.println("--- ENVIO " + String(idLeitura) + " ---");
    enviarTodasLeituras();
  }
}

// INICIALIZAÇÃO DOS SENSORES
void iniciarSensores() {
  gAHT20ok = (aht20.begin() == 0);
  if (!gAHT20ok) Serial.println("Erro: falha ao iniciar o AHT21!");

  gENS160ok = (ens160.begin() == NO_ERR);
  if (gENS160ok) {
    ens160.setPWRMode(ENS160_STANDARD_MODE);
    Serial.println("ENS160 iniciado. Aguardando aquecimento (~3 min para leituras precisas).");
  } else {
    Serial.println("Erro: falha ao iniciar o ENS160!");
  }
}

// LEITURA DOS SENSORES
void lerSensoresLocais() {
  // AHT21: temperatura e umidade
  if (gAHT20ok && aht20.startMeasurementReady(/*crcEn=*/true)) {
    gTemperatura = aht20.getTemperature_C();
    gUmidade = aht20.getHumidity_RH();
  }

  // ENS160: CO2 (eCO2) e TVOC, compensados por temp/umidade
  if (gENS160ok) {
    ens160.setTempAndHum(gTemperatura, gUmidade); // compensação melhora a precisão
    gCO2 = ens160.getECO2();
    gTVOC = ens160.getTVOC();
  }

  // MQ-4: metano
  int analogMQ4 = analogRead(PINO_MQ4);
  gCh4Pct = ((float)(analogMQ4 - limiteMin) / (limiteMax - limiteMin)) * 100.0;
  if (gCh4Pct < 0) gCh4Pct = 0;
  if (gCh4Pct > 100) gCh4Pct = 100;
  gCh4Ppm = gCh4Pct * PPM_POR_PERCENTUAL;

  Serial.println("CO2: " + String(gCO2) + " ppm | TVOC: " + String(gTVOC) + " ppb");
  Serial.println("Temp: " + String(gTemperatura) + " C | Umid: " + String(gUmidade) + " %");
  Serial.println("CH4: " + String(gCh4Pct) + "% (~" + String(gCh4Ppm, 1) + " ppm)");
  Serial.println("------");
}

// LEDs
void atualizarLeds() {
  // Par 1: MQ-4 (metano)
  bool alertaMQ4 = gCh4Pct > CH4_LIMITE_PCT;
  digitalWrite(LED_VERMELHO_MQ4, alertaMQ4 ? HIGH : LOW);
  digitalWrite(LED_VERDE_MQ4, alertaMQ4 ? LOW : HIGH);
  if (alertaMQ4) Serial.println("ATENÇÃO! Limite de Metano (MQ-4) atingido.");

  // Par 2: ENS160/AHT21 — CO2, temperatura e umidade compartilham o mesmo par
  bool alertaENS160 = (gCO2 > CO2_LIMITE_PPM) || (gTemperatura > TEMP_LIMITE_C) || (gUmidade > UMIDADE_LIMITE_PCT);
  digitalWrite(LED_VERMELHO_ENS160, alertaENS160 ? HIGH : LOW);
  digitalWrite(LED_VERDE_ENS160, alertaENS160 ? LOW : HIGH);
  if (alertaENS160) Serial.println("ATENÇÃO! CO2/Temperatura/Umidade fora da faixa segura (ENS160/AHT21).");
}

// LCD (alterna entre 2 telas a cada 2s)
void atualizarLCD() {
  telaAlternada = !telaAlternada;
  lcd.clear();

  if (telaAlternada) {
    lcd.setCursor(0, 0);
    lcd.print("CO2:" + String(gCO2) + "ppm");
    lcd.setCursor(0, 1);
    lcd.print("CH4:" + String((int)gCh4Ppm) + "ppm");
  } else {
    lcd.setCursor(0, 0);
    lcd.print("Temp:" + String(gTemperatura, 1) + "C");
    lcd.setCursor(0, 1);
    lcd.print("Umid:" + String(gUmidade, 1) + "%");
  }
}

// WIFI
void conectarWiFi() {
  Serial.print("Conectando ao WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 20000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi conectado. IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\nFalha ao conectar WiFi — nova tentativa no próximo ciclo.");
  }
}

// ENVIO PARA A API
void enviarTodasLeituras() {
  enviarLeitura("CO2", gCO2);
  enviarLeitura("VOC", gTVOC);
  enviarLeitura("Temperatura", gTemperatura);
  enviarLeitura("Umidade", gUmidade);
  enviarLeitura("CH4", gCh4Ppm);
}

void enviarLeitura(const char* tipo, float valor) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Sem WiFi — leitura de " + String(tipo) + " descartada.");
    return;
  }

  StaticJsonDocument<256> doc;
  doc["dispositivoId"] = DISPOSITIVO_ID;
  doc["tipo"] = tipo;
  doc["valor"] = valor;

  String corpo;
  serializeJson(doc, corpo);

  if (!tentarEnviar(corpo, tipo)) {
    delay(500);
    tentarEnviar(corpo, tipo); // 1 nova tentativa
  }
}

bool tentarEnviar(const String& corpo, const char* tipo) {
  WiFiClientSecure client;
  // setInsecure() pula a validação do certificado TLS — ok para protótipo. Em produção, valide o certificado (client.setCACert(...)).
  client.setInsecure();

  HTTPClient http;
  http.setTimeout(8000); // não trava o ESP32 esperando a API
  http.begin(client, API_URL_LEITURAS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", CHAVE_DISPOSITIVO);

  int codigoHttp = http.POST(corpo);
  bool ok = (codigoHttp == 201);

  if (ok) {
    Serial.println("OK [" + String(tipo) + "] -> HTTP " + String(codigoHttp));
  } else if (codigoHttp > 0) {
    Serial.println("Falha [" + String(tipo) + "] -> HTTP " + String(codigoHttp) + " | " + http.getString());
  } else {
    Serial.println("Falha [" + String(tipo) + "] -> erro de conexão (" + String(codigoHttp) + ")");
  }

  http.end();
  return ok;
}
