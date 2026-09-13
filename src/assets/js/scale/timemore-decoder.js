// timemore-decoder.js

const ALPHA_SMOOTHING = 0.2; // Constante α para filtro passa-baixo do caudal
const RING_SIZE = 5;

// Máquina de estado global, sem novas instâncias para evitar Garbage Collection
export const brewState = {
  weight: 0.0,
  time: 0,
  flowRateEMA: 0.0, // Filtro EMA de mL/s
  isStable: false,
  _isDirty: false, // Flag fundamental para o ciclo de renderização

  // Ring Buffers pré-alocados para cálculos matemáticos da derivada de fluxo
  weightRing: new Float32Array(RING_SIZE),
  timeRing: new Float32Array(RING_SIZE),
  ringIndex: 0,
};

// Contentor Uint8Array temporário para reconstituição de pacotes fraturados por MTU
const rxBuffer = new Uint8Array(64);
let rxLength = 0;

// Variáveis de controle para o filtro de fluxo inicial
let isBufferFilled = false;
let samplesCollected = 0;

/**
 * Descodificador otimizado para o protocolo Timemore.
 * Invocado a cada 50-100ms. Não contém alocação de memória (GC-friendly).
 *
 * @param {DataView} dataView - O buffer recebido do evento GATT.
 */
export function handleTimemoreData(dataView) {
  // Concatenação de pedaços recebidos no contentor temporário sem alocar novos arrays
  for (let i = 0; i < dataView.byteLength; i++) {
    if (rxLength >= rxBuffer.length) {
      // Buffer estourou sem encontrar frame válido. Desliza a memória para a esquerda (High-performance).
      rxBuffer.copyWithin(0, 1);
      rxLength--;
    }
    rxBuffer[rxLength++] = dataView.getUint8(i);
  }

  let offset = 0;

  // Validação de comprimento e alinhamento do frame (mínimo de 8 bytes)
  while (rxLength - offset >= 8) {
    const header = rxBuffer[offset];

    // Verificação de assinaturas comuns de cabeçalho (ex: 0xFD, 0x0A, 0x23)
    if (header !== 0xfd && header !== 0x0a && header !== 0x23) {
      offset++;
      continue;
    }

    // Desmontagem da máscara de bits no 4º byte (índice 3)
    const statusFlags = rxBuffer[offset + 3];
    const isNegative = (statusFlags & 0x01) === 0x01; // Bit 0 dita o sinal
    const isStable = (statusFlags & 0x02) === 0x02; // Bit 1 dita a estabilidade

    // Reconstrução da magnitude numérica Big-Endian através de Shift bit-a-bit
    // O hardware reporta múltiplos de 10 para representar precisão de 0.1g
    const rawWeight = (rxBuffer[offset + 4] << 8) | rxBuffer[offset + 5];
    let currentWeight = rawWeight / 10.0;

    // Tratamento algorítmico do sinal matemático para peso negativo (taragem invertida)
    if (isNegative) {
      currentWeight *= -1.0;
    }

    // Extração do cronómetro interno gerido pelo MCU da balança (segundos)
    const currentTime = (rxBuffer[offset + 6] << 8) | rxBuffer[offset + 7];

    updateTelemetry(currentWeight, currentTime, isStable);

    // Avança o offset garantindo não re-processar os mesmos dados no buffer
    offset += 8;
  }

  // Lógica de memória intermédia: reposicionar bytes não consumidos usando copyWithin nativo
  if (offset > 0) {
    rxLength -= offset;
    rxBuffer.copyWithin(0, offset, offset + rxLength);
  }
}

/**
 * Atualiza o estado global e aplica o cálculo derivativo do caudal.
 */
function updateTelemetry(weight, time, isStable) {
  const now = performance.now();
  const ptr = brewState.ringIndex;

  brewState.weight = weight;
  brewState.time = time;
  brewState.isStable = isStable;

  // Atualização da amostragem do Ring Buffer
  brewState.weightRing[ptr] = weight;
  brewState.timeRing[ptr] = now;

  const oldPtr = (ptr + 1) % RING_SIZE;

  // Só inicia o cálculo de fluxo quando o Ring Buffer não tiver mais zeros fantasmas
  if (!isBufferFilled) {
    samplesCollected++;
    if (samplesCollected >= RING_SIZE) isBufferFilled = true;
    brewState.ringIndex = oldPtr;
    brewState._isDirty = true; // Sinalizador imperativo para o renderizador
    return;
  }

  // Matemática do cálculo temporal e delta para vazão (mL/s)
  const deltaWeight = brewState.weightRing[ptr] - brewState.weightRing[oldPtr];
  const deltaTimeSeconds = (brewState.timeRing[ptr] - brewState.timeRing[oldPtr]) / 1000.0;

  // Bloqueia deltas de tempo extremos (ex: app minimizado) para não quebrar o EMA
  if (deltaTimeSeconds > 0 && deltaTimeSeconds < 1.0) {
    let rawFlow = deltaWeight / deltaTimeSeconds;
    rawFlow = rawFlow < 0 ? 0 : rawFlow; // Evitar débitos negativos anómalos

    // Matemática do filtro passa-baixo EMA
    brewState.flowRateEMA =
      ALPHA_SMOOTHING * rawFlow + (1 - ALPHA_SMOOTHING) * brewState.flowRateEMA;
  } else if (deltaTimeSeconds >= 1.0) {
    // Reset silencioso do fluxo se houve salto temporal longo
    brewState.flowRateEMA = 0;
  }

  brewState.ringIndex = oldPtr;
  brewState._isDirty = true;
}
