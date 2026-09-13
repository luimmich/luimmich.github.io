// ble-manager.js

// Definições restritas dos perfis UART estipulados pela Timemore[cite: 1]
const TIMEMORE_SERVICE_UUID = 0xffe0; // Serviço Principal (UART)[cite: 1]
const TIMEMORE_CHARACTERISTIC_UUID = 0xffe1; // Característica RX / TX[cite: 1]

// Mapas de alocação estática para comandos hexadecimais (Prevenindo instanciação extra)[cite: 1]
const COMMANDS = {
  TARE: new Uint8Array([0xfd, 0x00, 0x01, 0x01, 0x00, 0x02, 0x00]), // Zera a célula de carga[cite: 1]
  TIMER_START: new Uint8Array([0xfd, 0x00, 0x02, 0x01, 0x01, 0x04, 0x00]), // Inicia os ciclos do relógio[cite: 1]
  TIMER_PAUSE: new Uint8Array([0xfd, 0x00, 0x02, 0x01, 0x02, 0x05, 0x00]), // Pausa incremento temporal[cite: 1]
  TIMER_RESET: new Uint8Array([0xfd, 0x00, 0x02, 0x01, 0x00, 0x03, 0x00]), // Repõe o acumulador a zeros[cite: 1]
};

// Algoritmo de backoff exponencial para gerir falhas de ligação[cite: 1]
const MAX_ATTEMPTS = 5; //[cite: 1]
const BASE_DELAY = 1000; // 1 segundo[cite: 1]

export class BLEManager {
  constructor(onDataReceived, onDisconnectStatus) {
    this.device = null;
    this.characteristic = null;
    this.onDataReceived = onDataReceived;
    this.onDisconnectStatus = onDisconnectStatus;
    this.reconnectAttempts = 0; // Estado isolado de tentativas[cite: 1]

    // Vinculação léxica de contexto
    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._handleNotifications = this._handleNotifications.bind(this);
  }

  async connect() {
    try {
      // Mapeamento imperativo dos UUIDs durante o emparelhamento[cite: 1]
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "TIMEMORE" }], // Filtro genérico SKU[cite: 1]
        optionalServices: [TIMEMORE_SERVICE_UUID], // Impede exceção de Service Not Found[cite: 1]
      });

      this.device.addEventListener("gattserverdisconnected", this._handleDisconnect);
      await this._establishGATT(this.device);
    } catch (error) {
      console.error("Falha na negociação GATT:", error); //[cite: 1]
      throw error;
    }
  }

  async _establishGATT(device) {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(TIMEMORE_SERVICE_UUID);

    this.characteristic = await service.getCharacteristic(TIMEMORE_CHARACTERISTIC_UUID);

    // Ativação da subscrição bidirecional (Notificações)[cite: 1]
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener("characteristicvaluechanged", this._handleNotifications);

    this.reconnectAttempts = 0; // Rearmar o algoritmo de recuperação[cite: 1]
    if (this.onDisconnectStatus) this.onDisconnectStatus(true);
  }

  _handleNotifications(event) {
    // Redireciona o DataView nativo de alta performance[cite: 1]
    if (this.onDataReceived) {
      this.onDataReceived(event.target.value);
    }
  }

  _handleDisconnect(event) {
    if (this.onDisconnectStatus) this.onDisconnectStatus(false);
    const device = event.target;
    console.warn(`Enlace perdido com ${device.name}. Iniciando recuperação...`); //[cite: 1]
    this._executeBackoffReconnection(device);
  }

  _executeBackoffReconnection(device) {
    if (this.reconnectAttempts >= MAX_ATTEMPTS) {
      console.error("Recuperação falhou. Intervenção manual do utilizador requerida."); //[cite: 1]
      return;
    }

    // Incremento temporal não-linear (Exponential Backoff)[cite: 1]
    const backoffDelay = Math.pow(2, this.reconnectAttempts) * BASE_DELAY;
    this.reconnectAttempts++;

    setTimeout(async () => {
      try {
        console.info(`Tentativa de reconexão #${this.reconnectAttempts}`); //[cite: 1]
        await this._establishGATT(device); // É mandatório refazer a cadeia GATT[cite: 1]
      } catch (error) {
        console.error("Tentativa falhada:", error); //[cite: 1]
        this._executeBackoffReconnection(device); // Chamada recursiva assíncrona[cite: 1]
      }
    }, backoffDelay);
  }

  async sendCommand(commandKey) {
    if (!this.characteristic) return;
    const payload = COMMANDS[commandKey];

    try {
      // Dispensando o ACK da camada de ligação para minimizar latência para menos de 5ms[cite: 1]
      if (this.characteristic.properties.writeWithoutResponse) {
        await this.characteristic.writeValueWithoutResponse(payload);
      } else if (this.characteristic.properties.write) {
        await this.characteristic.writeValue(payload); // Fallback do firmware[cite: 1]
      }
    } catch (error) {
      console.error("Erro transacional de envio BLE:", error); // Exceções geralmente denotam falha no CoreBluetooth[cite: 1]
    }
  }
}
