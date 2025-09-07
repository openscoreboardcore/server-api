class WebSocketClient {
	private url: string;
	private socket: WebSocket | null = null;
	private reconnectDelay: number = 1000; // start at 1s
	private readonly maxReconnectDelay: number = 30000; // cap at 30s
	private readonly messageQueue: string[] = [];
	private isManuallyClosed: boolean = false;

	constructor(url: string) {
		this.url = url;
		this.connect();
	}

	private connect() {
		this.socket = new WebSocket(this.url);

		this.socket.onopen = () => {
			console.log("✅ Connected:", this.url);

			// Reset delay after successful connection
			this.reconnectDelay = 1000;

			// Flush queued messages
			while (this.messageQueue.length > 0) {
				const msg = this.messageQueue.shift();
				if (msg) this.send(msg);
			}
		};

		this.socket.onmessage = (event) => {
			// console.log("📩 Message:", event.data);
			// check if message is json
			try {
				const data = JSON.parse(event.data);
				console.log("📩 JSON Message:", data);
			} catch (e) {
				console.log("📩 Text Message:", event.data);
			}
		};

		this.socket.onclose = () => {
			console.warn("⚠️ Disconnected:", this.url);
			if (!this.isManuallyClosed) this.scheduleReconnect();
		};

		this.socket.onerror = (err) => {
			console.error("❌ WebSocket error:", err);
			this.socket?.close();
		};
	}

	private scheduleReconnect() {
		console.log(`🔄 Reconnecting in ${this.reconnectDelay / 1000}s...`);
		setTimeout(() => {
			this.reconnectDelay = Math.min(
				this.reconnectDelay * 2,
				this.maxReconnectDelay
			);
			this.connect();
		}, this.reconnectDelay);
	}

	public send(message: string) {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(message);
		} else {
			console.log("⏳ Queuing message:", message);
			this.messageQueue.push(message);
		}
	}

	public close() {
		this.isManuallyClosed = true;
		this.socket?.close();
	}
}

export default WebSocketClient;
