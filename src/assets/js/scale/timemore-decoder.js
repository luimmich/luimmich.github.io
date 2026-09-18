// timemore-decoder.js

const ALPHA_SMOOTHING = 0.2; // Constante α para filtro passa-baixo do caudal
const RING_SIZE = 5;
const MIN_PACKET_GAP_MS = 30;
const TARE_DELTA_THRESHOLD_G = 5.0;

// Máquina de estado global
export const brewState = {
  weight: 0.0,
  time: 0,
  flowRateEMA: 0.0,
  isStable: false,
  _isDirty: false,
  lastPacketTime: 0,

  weightRing: new Float32Array(RING_SIZE),
  timeRing: new Float32Array(RING_SIZE),
  ringIndex: 0,
};

const rxBuffer = new Uint8Array(64);
let rxLength = 0;

// Variáveis de controle de fluxo
let isBufferFilled = false;
let samplesCollected = 0;

/**
 * Zera as barreiras de segurança do decodificador e limpa a memória do ring buffer.
 * DEVE ser chamado pelo app.js sempre que uma extração for resetada.
 */
export function resetDecoderState() {
  isBufferFilled = false;
  samplesCollected = 0;
  brewState.lastPacketTime = 0;
  brewState.flowRateEMA = 0;
  brewState.ringIndex = 0;
  brewState._isDirty = false;
  brewState.weightRing.fill(0);
  brewState.timeRing.fill(0);
}

export function handleTimemoreData(dataView) {
  const incoming =
    dataView instanceof Uint8Array
      ? dataView
      : new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  const incomingLength = incoming.length;
  if (incomingLength === 0) return;

  // Ingestão em bloco contíguo na memória sem laços manuais byte-a-byte
  if (incomingLength >= rxBuffer.length) {
    rxBuffer.set(incoming.subarray(incomingLength - rxBuffer.length));
    rxLength = rxBuffer.length;
  } else {
    if (rxLength + incomingLength > rxBuffer.length) {
      const overflow = rxLength + incomingLength - rxBuffer.length;
      rxBuffer.copyWithin(0, overflow, rxLength);
      rxLength -= overflow;
    }
    rxBuffer.set(incoming, rxLength);
    rxLength += incomingLength;
  }

  let offset = 0;

  while (rxLength - offset >= 8) {
    const header = rxBuffer[offset];

    if (header !== 0xfd && header !== 0x0a && header !== 0x23) {
      offset++;
      continue;
    }

    const statusFlags = rxBuffer[offset + 3];
    const isNegative = (statusFlags & 0x01) === 0x01;
    const isStable = (statusFlags & 0x02) === 0x02;

    const rawWeight = (rxBuffer[offset + 4] << 8) | rxBuffer[offset + 5];
    let currentWeight = rawWeight / 10.0;

    if (isNegative) currentWeight *= -1.0;

    const currentTime = (rxBuffer[offset + 6] << 8) | rxBuffer[offset + 7];

    updateTelemetry(currentWeight, currentTime, isStable);
    offset += 8;
  }

  if (offset > 0) {
    rxLength -= offset;
    rxBuffer.copyWithin(0, offset, offset + rxLength);
  }
}

function updateTelemetry(weight, time, isStable) {
  const now = performance.now();

  if (brewState.lastPacketTime !== 0 && now - brewState.lastPacketTime < MIN_PACKET_GAP_MS) {
    return;
  }
  brewState.lastPacketTime = now;

  const ptr = brewState.ringIndex;
  const oldPtr = (ptr + 1) % RING_SIZE;

  brewState.weight = weight;
  brewState.time = time;
  brewState.isStable = isStable;

  brewState.weightRing[ptr] = weight;
  brewState.timeRing[ptr] = now;

  if (!isBufferFilled) {
    samplesCollected++;
    if (samplesCollected >= RING_SIZE) isBufferFilled = true;
    brewState.ringIndex = oldPtr;
    brewState._isDirty = true;
    return;
  }

  const previousWeight = brewState.weightRing[oldPtr];
  const deltaWeight = brewState.weightRing[ptr] - previousWeight;

  if (deltaWeight < -TARE_DELTA_THRESHOLD_G) {
    resetDecoderState();
    brewState.weightRing[0] = weight;
    brewState.timeRing[0] = now;
    brewState.ringIndex = 1;
    samplesCollected = 1;
    brewState._isDirty = true;
    return;
  }

  const deltaTimeSeconds = (brewState.timeRing[ptr] - brewState.timeRing[oldPtr]) / 1000.0;

  if (deltaTimeSeconds > 0 && deltaTimeSeconds < 1.0) {
    let rawFlow = deltaWeight / deltaTimeSeconds;
    rawFlow = rawFlow < 0 ? 0 : rawFlow;

    brewState.flowRateEMA =
      ALPHA_SMOOTHING * rawFlow + (1 - ALPHA_SMOOTHING) * brewState.flowRateEMA;
  } else if (deltaTimeSeconds >= 1.0) {
    brewState.flowRateEMA = 0;
  }

  brewState.ringIndex = oldPtr;
  brewState._isDirty = true;
}
