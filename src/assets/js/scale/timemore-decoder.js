// timemore-decoder.js

const ALPHA_SMOOTHING = 0.2; // Constante α para filtro passa-baixo do caudal
const RING_SIZE = 5;

// Máquina de estado global, sem novas instâncias para evitar Garbage Collection
export const brewState = {
  weight: 0.0,
  time: 0,
  flowRateEMA: 0.0, // Filtro EMA de mL/s
  isStable: false,
  _isDirty: false, // Flag fundamental para o ciclo de renderização[cite: 1]

  // Ring Buffers pré-alocados para cálculos matemáticos da derivada de fluxo[cite: 1]
  weightRing: new Float32Array(RING_SIZE),
  timeRing: new Float32Array(RING_SIZE),
  ringIndex: 0,
};

// Contentor Uint8Array temporário para reconstituição de pacotes fraturados por MTU[cite: 1]
const rxBuffer = new Uint8Array(64);
let rxLength = 0;

/**
 * Descodificador otimizado para o protocolo Timemore[cite: 1].
 * Invocado a cada 50-100ms. Não contém alocação de memória (GC-friendly)[cite: 1].
 *
 * @param {DataView} dataView - O buffer recebido do evento GATT[cite: 1].
 */
export function handleTimemoreData(dataView) {
  // Concatenação de pedaços recebidos no contentor temporário sem alocar novos arrays[cite: 1]
  for (let i = 0; i < dataView.byteLength; i++) {
    if (rxLength < rxBuffer.length) {
      rxBuffer[rxLength++] = dataView.getUint8(i);
    }
  }

  let offset = 0;

  // Validação de comprimento e alinhamento do frame (mínimo de 8 bytes)[cite: 1]
  while (rxLength - offset >= 8) {
    const header = rxBuffer[offset];

    // Verificação de assinaturas comuns de cabeçalho (ex: 0xFD, 0x0A, 0x23)[cite: 1]
    if (header !== 0xfd && header !== 0x0a && header !== 0x23) {
      offset++;
      continue;
    }

    // Desmontagem da máscara de bits no 4º byte (índice 3)[cite: 1]
    const statusFlags = rxBuffer[offset + 3];
    const isNegative = (statusFlags & 0x01) === 0x01; // Bit 0 dita o sinal[cite: 1]
    const isStable = (statusFlags & 0x02) === 0x02; // Bit 1 dita a estabilidade[cite: 1]

    // Reconstrução da magnitude numérica Big-Endian através de Shift bit-a-bit[cite: 1]
    // O hardware reporta múltiplos de 10 para representar precisão de 0.1g[cite: 1]
    const rawWeight = (rxBuffer[offset + 4] << 8) | rxBuffer[offset + 5];
    let currentWeight = rawWeight / 10.0;

    // Tratamento algorítmico do sinal matemático para peso negativo (taragem invertida)[cite: 1]
    if (isNegative) {
      currentWeight *= -1.0;
    }

    // Extração do cronómetro interno gerido pelo MCU da balança (segundos)[cite: 1]
    const currentTime = (rxBuffer[offset + 6] << 8) | rxBuffer[offset + 7];

    updateTelemetry(currentWeight, currentTime, isStable);

    // Avança o offset garantindo não re-processar os mesmos dados no buffer
    offset += 8;
  }

  // Lógica de memória intermédia: reposicionar bytes não consumidos[cite: 1]
  if (offset > 0) {
    rxLength -= offset;
    for (let i = 0; i < rxLength; i++) {
      rxBuffer[i] = rxBuffer[offset + i];
    }
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

  // Atualização da amostragem do Ring Buffer[cite: 1]
  brewState.weightRing[ptr] = weight;
  brewState.timeRing[ptr] = now;

  // Matemática do cálculo temporal e delta para vazão (mL/s)[cite: 1]
  const oldPtr = (ptr + 1) % RING_SIZE;
  const deltaWeight = brewState.weightRing[ptr] - brewState.weightRing[oldPtr];
  const deltaTimeSeconds = (brewState.timeRing[ptr] - brewState.timeRing[oldPtr]) / 1000.0;

  if (deltaTimeSeconds > 0) {
    let rawFlow = deltaWeight / deltaTimeSeconds;
    rawFlow = rawFlow < 0 ? 0 : rawFlow; // Evitar débitos negativos anómalos[cite: 1]

    // Matemática do filtro passa-baixo EMA[cite: 1]
    brewState.flowRateEMA =
      ALPHA_SMOOTHING * rawFlow + (1 - ALPHA_SMOOTHING) * brewState.flowRateEMA;
  }

  brewState.ringIndex = oldPtr;
  brewState._isDirty = true; // Sinalizador imperativo para o renderizador[cite: 1]
}
