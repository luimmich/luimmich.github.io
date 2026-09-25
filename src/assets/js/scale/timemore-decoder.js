// timemore-decoder.js — parser dos frames do Timemore DOT (TES017).
// Frame: A5 5A | opcode | cmd | len(2, BE) | data | crc(2, BE)
//   cmd 0x01: weight(int32, /10 g) | flow(uint16, /10 g/s) | timer(uint16, s) | overload(u8)
// O DOT não valida CRC no que envia, então o parse ignora o CRC.

const ALPHA_SMOOTHING = 0.2;
const STABLE_DELTA_G = 0.2;
const STABLE_MS = 500;

// Carry entre notificações: um frame partido entre pacotes continua válido.
// ponytail: 64 B cobre com folga os frames de ~10 B; rajadas maiores descartam
// o excedente mais antigo. Upgrade: fila dinâmica se o firmware mudar.
const rxBuffer = new Uint8Array(64);
let rxLength = 0;
let lastWeight = 0;
let stableSince = 0;

export const brewState = {
  weight: 0.0,
  time: 0,
  flowRateEMA: 0.0,
  isStable: false,
  _isDirty: false,
};

export function resetDecoderState() {
  rxLength = 0;
  lastWeight = 0;
  stableSince = performance.now();
  brewState.flowRateEMA = 0;
  brewState.isStable = false;
  brewState._isDirty = false;
}

export function handleTimemoreData(dataView) {
  const incoming =
    dataView instanceof Uint8Array
      ? dataView
      : new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
  if (incoming.length === 0) return;

  if (incoming.length >= rxBuffer.length) {
    rxBuffer.set(incoming.subarray(incoming.length - rxBuffer.length));
    rxLength = rxBuffer.length;
  } else {
    if (rxLength + incoming.length > rxBuffer.length) {
      const keep = rxBuffer.length - incoming.length;
      rxBuffer.copyWithin(0, rxLength - keep, rxLength);
      rxLength = keep;
    }
    rxBuffer.set(incoming, rxLength);
    rxLength += incoming.length;
  }

  // Notificações podem trazer vários frames; varre procurando o header A5 5A.
  let i = 0;
  while (i + 8 <= rxLength) {
    if (rxBuffer[i] !== 0xa5 || rxBuffer[i + 1] !== 0x5a) {
      i++;
      continue;
    }

    const cmd = rxBuffer[i + 3];
    const len = (rxBuffer[i + 4] << 8) | rxBuffer[i + 5];
    if (i + 8 + len > rxLength) break; // frame incompleto: fica no carry

    if (cmd === 0x01 && len >= 8) applyWeightFrame(i + 6, len);
    i += 8 + len;
  }

  if (i > 0) {
    rxBuffer.copyWithin(0, i, rxLength);
    rxLength -= i;
  }
}

function applyWeightFrame(d, len) {
  const weight =
    (((rxBuffer[d] << 24) | (rxBuffer[d + 1] << 16) | (rxBuffer[d + 2] << 8) | rxBuffer[d + 3]) |
      0) /
    10;
  const rawFlow = ((rxBuffer[d + 4] << 8) | rxBuffer[d + 5]) / 10;
  const overload = len >= 9 ? rxBuffer[d + 8] : 0;

  brewState.weight = weight;
  brewState.time = (rxBuffer[d + 6] << 8) | rxBuffer[d + 7];
  brewState.flowRateEMA =
    ALPHA_SMOOTHING * rawFlow + (1 - ALPHA_SMOOTHING) * brewState.flowRateEMA;

  // ponytail: o DOT não manda flag de estabilidade; derivamos da variação de
  // peso. Ceiling: ~500ms de atraso após parar de mexer. Upgrade: usar o bit de
  // estável se o firmware passar a expor.
  const now = performance.now();
  if (Math.abs(weight - lastWeight) > STABLE_DELTA_G) {
    lastWeight = weight;
    stableSince = now;
  }
  brewState.isStable = overload === 0 && now - stableSince >= STABLE_MS;
  brewState._isDirty = true;
}
