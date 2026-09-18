// ble-manager.js

const TIMEMORE_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const TIMEMORE_CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

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
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;

    this.commandQueue = Promise.resolve();
    this.abortController = new AbortController();

    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._handleNotifications = this._handleNotifications.bind(this);
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth não é suportado ou exige contexto HTTPS.");
    }

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [TIMEMORE_SERVICE_UUID] }],
      });

      this.device.addEventListener("gattserverdisconnected", this._handleDisconnect, {
        signal: this.abortController.signal,
      });

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

    this.characteristic.addEventListener("characteristicvaluechanged", this._handleNotifications, {
      signal: this.abortController.signal,
    });

    await this.characteristic.startNotifications();

    this.device = device;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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

    const device = event && event.target ? event.target : this.device;
    if (!device || !device.gatt) {
      console.warn("Dispositivo desconectado sem referência GATT válida. Ignorando reconexão.");
      return;
    }

    console.warn(
      `Conexão perdida com ${device ? device.name : "dispositivo"}. Iniciando recuperação...`,
    );
    this._executeBackoffReconnection(device);
  }

  _executeBackoffReconnection(device) {
    if (!device || !device.gatt) {
      console.warn("Reconexão abortada: dispositivo inválido.");
      return;
    }

    if (this.reconnectAttempts >= MAX_ATTEMPTS) {
      console.error("Limite de reconexões atingido. Ação manual necessária.");
      return;
    }

    const backoffDelay = Math.pow(2, this.reconnectAttempts) * BASE_DELAY;
    this.reconnectAttempts++;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(async () => {
      try {
        console.info(`Tentativa de reconexão #${this.reconnectAttempts}...`);
        await this._establishGATT(device);
      } catch (error) {
        console.error("Falha na reconexão:", error);
        this._executeBackoffReconnection(device);
      }
    }, backoffDelay);
  }

  sendCommand(commandKey) {
    const payload = COMMANDS[commandKey];
    if (!this.characteristic || !payload) return Promise.resolve();

    this.commandQueue = this.commandQueue.then(async () => {
      try {
        if (this.characteristic.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(payload);
        } else if (this.characteristic.properties.write) {
          await this.characteristic.writeValue(payload);
        }
      } catch (error) {
        console.error(`Erro ao enviar comando BLE (${commandKey}):`, error);
      }
    });

    return this.commandQueue;
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;

    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.intentionalDisconnect = true;

      this.abortController.abort();
      this.abortController = new AbortController();

      this.device.gatt.disconnect();
      this.characteristic = null;
      this.device = null;
      console.log("Conexão GATT encerrada intencionalmente.");
    } else {
      this.characteristic = null;
      this.device = null;
    }
  }
}
