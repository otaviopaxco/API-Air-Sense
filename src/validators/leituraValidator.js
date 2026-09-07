const Joi = require('joi');

const TIPOS_VALIDOS = ['CO2', 'CH4', 'VOC', 'Temperatura', 'Umidade'];

// Faixas plausíveis por tipo — usadas para rejeitar leituras claramente
// defeituosas (sensor desconectado, ruído, etc.) antes de irem ao banco.
const FAIXAS = {
  CO2: { min: 0, max: 10000 }, // ppm
  CH4: { min: 0, max: 50000 }, // ppm
  VOC: { min: 0, max: 60000 }, // ppb
  Temperatura: { min: -40, max: 85 }, // °C
  Umidade: { min: 0, max: 100 }, // %
};

const leituraSchema = Joi.object({
  dispositivoId: Joi.string().trim().min(1).required(),
  valor: Joi.number().required(),
  tipo: Joi.string().valid(...TIPOS_VALIDOS).required(),
  horarioLeitura: Joi.string().isoDate().optional(), // se ausente, servidor usa Date.now()
});

function validarLeitura(payload) {
  const { error, value } = leituraSchema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) {
    return { valido: false, erros: error.details.map((d) => d.message) };
  }

  // Checagem explícita de NaN/Infinity — feita aqui (em vez de depender de
  // um método específico do Joi) para não quebrar de novo se a biblioteca
  // mudar de versão outra vez.
  if (!Number.isFinite(value.valor)) {
    return { valido: false, erros: [`Valor "${value.valor}" não é um número finito válido.`] };
  }

  const faixa = FAIXAS[value.tipo];
  if (value.valor < faixa.min || value.valor > faixa.max) {
    return {
      valido: false,
      erros: [`Valor ${value.valor} fora da faixa plausível para ${value.tipo} (${faixa.min}–${faixa.max}).`],
    };
  }

  return { valido: true, dados: value };
}

module.exports = { validarLeitura, TIPOS_VALIDOS, FAIXAS };
