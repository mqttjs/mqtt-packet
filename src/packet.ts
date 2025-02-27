export default class Packet {
	cmd: string

	retain: boolean

	qos: number

	dup: boolean

	length: number

	topic: string

	payload: Buffer

	constructor() {
		this.cmd = null
		this.retain = false
		this.qos = 0
		this.dup = false
		this.length = -1
		this.topic = null
		this.payload = null
	}
}
