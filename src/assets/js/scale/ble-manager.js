// ble-manager.js — Timemore DOT (TES017), framed protocol.
// Ref: TIMEMORE open-scale-protocol v1.0.3
//   frame: A5 5A | opcode | cmd | len(2, BE) | data | crc16(2, BE)
//   svc FFF0, notify FFF1, write FFF2.

const SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
const NOTIFY_UUID = "0000fff1-0000-1000-8000-00805f9b34fb";
const WRITE_UUID = "0000fff2-0000-1000-8000-00805f9b34fb";

const OP_READ = 0x02;
const OP_WRITE = 0x03;
const CMD_TIMER = 0x02;
const CMD_BATTERY = 0x05;
const CMD_UNIT = 0x06;
const CMD_MODE = 0x08;
const CMD_TARE = 0x0d;
const TIMER = { TIMER_START: 0x01, TIMER_PAUSE: 0x02, TIMER_RESET: 0x03 };

// Beanconqueror identifica o DOT pelo nome conter "dot"/"tes017"; Web Bluetooth
// não tem substring, então casamos por prefixo + o serviço FFF0 (caminho
// confiável confirmado pelo lib de referência).
const FILTERS = [
  { services: [SERVICE_UUID] },
  { namePrefix: "TIMEMORE" },
  { namePrefix: "Timemore" },
  { namePrefix: "DOT" },
  { namePrefix: "TES017" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function crc16(bytes) {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc & 0xffff;
}

function buildFrame(opcode, cmd, data = []) {
  const frame = [0xa5, 0x5a, opcode, cmd, (data.length >> 8) & 0xff, data.length & 0xff, ...data];
  const crc = crc16(frame);
  frame.push((crc >> 8) & 0xff, crc & 0xff);
  return new Uint8Array(frame);
}

const COMMANDS = {
  TARE: buildFrame(OP_WRITE, CMD_TARE),
  TIMER_START: buildFrame(OP_WRITE, CMD_TIMER, [TIMER.TIMER_START]),
  TIMER_PAUSE: buildFrame(OP_WRITE, CMD_TIMER, [TIMER.TIMER_PAUSE]),
  TIMER_RESET: buildFrame(OP_WRITE, CMD_TIMER, [TIMER.TIMER_RESET]),
  UNIT_GRAM: buildFrame(OP_WRITE, CMD_UNIT, [0x00]),
  // Init padrão do Beanconqueror/lib oficial: grama (0x06) + modo standard (0x08).
  MODE: buildFrame(OP_WRITE, CMD_MODE, [0x01, 0x00]),
  BATTERY_READ: buildFrame(OP_READ, CMD_BATTERY),
};

export class BLEManager {
  constructor(onDataReceived, onDisconnectStatus) {
    this.device = null;
    this.notify = null;
    this.write = null;
    this.onDataReceived = onDataReceived;
    this.onDisconnectStatus = onDisconnectStatus;
    this.intentionalDisconnect = false;

    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._handleNotifications = this._handleNotifications.bind(this);
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth não é suportado ou exige contexto HTTPS.");
    }

    // Conexão viva: não reconecta/re-inscreve (evita listener duplicado).
    if (this.notify && this.device?.gatt?.connected) return;

    // Reconecta no device já autorizado sem reabrir o seletor (o botão connect
    // vira 1 toque depois de uma queda). Só abre o seletor se falhar.
    if (this.device && this.device.gatt) {
      try {
        await this._establishGATT(this.device);
        return;
      } catch (err) {
        console.warn("Reconexão direta falhou, abrindo seletor:", err);
      }
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: FILTERS,
      optionalServices: [SERVICE_UUID],
    });
    await this._establishGATT(this.device);
  }

  async _establishGATT(device) {
    const server = await device.gatt.connect();
    // once: some sozinho na queda, então re-arma a cada (re)conexão.
    device.addEventListener("gattserverdisconnected", this._handleDisconnect, { once: true });

    const service = await server.getPrimaryService(SERVICE_UUID);
    const notify = await service.getCharacteristic(NOTIFY_UUID);
    this.write = await service.getCharacteristic(WRITE_UUID);

    notify.addEventListener("characteristicvaluechanged", this._handleNotifications);
    await notify.startNotifications();
    // Só publica depois de inscrito, para o guard do connect() ser confiável.
    this.notify = notify;
    this.device = device;

    // Sequência de init do Beanconqueror: deixa assentar, força grama, espera,
    // então modo standard (o DOT guarda a última unidade/modo).
    await sleep(500);
    await this._write(COMMANDS.UNIT_GRAM);
    await sleep(200);
    await this._write(COMMANDS.MODE);
    await this._write(COMMANDS.BATTERY_READ);

    this.onDisconnectStatus?.(true);
  }

  _handleNotifications(event) {
    if (this.onDataReceived && event.target && event.target.value) {
      this.onDataReceived(event.target.value);
    }
  }

  _handleDisconnect() {
    if (this.intentionalDisconnect) {
      this.intentionalDisconnect = false;
      return;
    }
    this.notify = null;
    this.write = null;
    this.onDisconnectStatus?.(false);
  }

  async _write(frame) {
    if (!this.write || !frame) return;
    try {
      if (this.write.properties.writeWithoutResponse) {
        await this.write.writeValueWithoutResponse(frame);
      } else {
        await this.write.writeValue(frame);
      }
    } catch (err) {
      console.error("Falha ao escrever BLE:", err);
    }
  }

  sendCommand(commandKey) {
    const frame = COMMANDS[commandKey];
    return frame ? this._write(frame) : Promise.resolve();
  }

  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.intentionalDisconnect = true;
      this.device.gatt.disconnect();
    }
    this.notify = null;
    this.write = null;
    // ponytail: mantém this.device para reconectar sem seletor (gatt.connect).
    // Ceiling: sem UI pra trocar de balança sem recarregar. Upgrade: ação
    // "esquecer balança" que zera this.device.
  }
}
