// ble-manager.js

const TIMEMORE_SERVICE_UUID = 0xffe0;
const TIMEMORE_CHARACTERISTIC_UUID = 0xffe1;

const COMMANDS = {
  TARE: new Uint8Array([0xfd, 0x00, 0x01, 0x01, 0x00, 0x02, 0x00]),
  TIMER_START: new Uint8Array([0xfd, 0x00, 0x02, 0x01, 0x01, 0x04, 0x00]),
  TIMER_PAUSE: new Uint8Array([0xfd, 0x00, 0x02, 0x01, 0x02, 0x05, 0x00]),
  TIMER_RESET: new Uint8Array([0xfd, 0x00, 0x02, 0x01, 0x00, 0x03, 0x00]),
};

const MAX_ATTEMPTS = 5;
const BASE_DELAY = 1000;

export class BLEManager {
  constructor(onDataReceived, onDisconnectStatus) {
    this.device = null;
    this.characteristic = null;
    this.onDataReceived = onDataReceived;
    this.onDisconnectStatus = onDisconnectStatus;

    this.reconnectAttempts = 0;
    this.intentionalDisconnect = false;
    this.isCommandPending = false;

    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._handleNotifications = this._handleNotifications.bind(this);
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error(
        "Web Bluetooth não é suportado neste navegador ou exige contexto seguro (HTTPS).",
      );
    }

    try {
      // requestDevice é executado imediatamente no topo da chamada para preservar o evento do usuário
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "TIMEMORE" }, { namePrefix: "TES" }, { namePrefix: "BK" }],
        optionalServices: [TIMEMORE_SERVICE_UUID],
      });

      // Remove event listeners antigos para evitar chamadas duplicadas
      this.device.removeEventListener("gattserverdisconnected", this._handleDisconnect);
      this.device.addEventListener("gattserverdisconnected", this._handleDisconnect);

      await this._establishGATT(this.device);
    } catch (error) {
      console.error("Falha na negociação BLE:", error);
      throw error;
    }
  }

  async _establishGATT(device) {
    if (!device || !device.gatt) {
      throw new Error("Dispositivo inválido ou sem interface GATT.");
    }

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(TIMEMORE_SERVICE_UUID);

    this.characteristic = await service.getCharacteristic(TIMEMORE_CHARACTERISTIC_UUID);

    // Evita ouvintes duplicados no canal de notificação
    this.characteristic.removeEventListener(
      "characteristicvaluechanged",
      this._handleNotifications,
    );
    this.characteristic.addEventListener("characteristicvaluechanged", this._handleNotifications);

    await this.characteristic.startNotifications();

    this.reconnectAttempts = 0;
    if (this.onDisconnectStatus) this.onDisconnectStatus(true);
  }

  _handleNotifications(event) {
    if (this.onDataReceived && event.target && event.target.value) {
      this.onDataReceived(event.target.value);
    }
  }

  _handleDisconnect(event) {
    if (this.onDisconnectStatus) this.onDisconnectStatus(false);

    if (this.intentionalDisconnect) {
      this.intentionalDisconnect = false;
      return;
    }

    const device = event.target;
    console.warn(
      `Conexão perdida com ${device ? device.name : "dispositivo"}. Iniciando recuperação...`,
    );
    this._executeBackoffReconnection(device);
  }

  _executeBackoffReconnection(device) {
    if (this.reconnectAttempts >= MAX_ATTEMPTS) {
      console.error("Limite de reconexões atingido. Ação manual necessária.");
      return;
    }

    const backoffDelay = Math.pow(2, this.reconnectAttempts) * BASE_DELAY;
    this.reconnectAttempts++;

    setTimeout(async () => {
      try {
        console.info(`Tentativa de reconexão #${this.reconnectAttempts}...`);
        await this._establishGATT(device);
      } catch (error) {
        console.error("Falha na reconexão:", error);
        this._executeBackoffReconnection(device);
      }
    }, backoffDelay);
  }

  async sendCommand(commandKey) {
    if (!this.characteristic || this.isCommandPending) return;

    const payload = COMMANDS[commandKey];
    if (!payload) {
      console.warn(`Comando não reconhecido: ${commandKey}`);
      return;
    }

    this.isCommandPending = true;

    try {
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(payload);
      } else if (this.characteristic.properties.write) {
        await this.characteristic.writeValue(payload);
      }
    } catch (error) {
      console.error("Erro ao enviar comando BLE:", error);
    } finally {
      setTimeout(() => {
        this.isCommandPending = false;
      }, 150);
    }
  }

  disconnect() {
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.intentionalDisconnect = true;
      this.device.gatt.disconnect();
      console.log("Conexão GATT encerrada intencionalmente.");
    }
  }
}
