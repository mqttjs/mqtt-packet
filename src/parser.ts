import bl from 'bl'
import { EventEmitter } from 'events'
import Packet from './packet'
import * as constants from './constants'
import * as debug from 'debug'
import { BufferList } from 'bl/BufferList'

const debugLog = debug('mqtt-packet:parser')

// Type definitions for reused structures
interface ParseVarByteNumResult {
	bytes: number
	value: number
}

interface StringPair {
	name: string
	value: string
}

// Interface for parser settings
interface ParserSettings {
	protocolVersion?: number
	bridgeMode?: boolean
	[key: string]: any
}

// Interface for property types
type PropertyTypes =
	| 'byte'
	| 'int8'
	| 'int16'
	| 'int32'
	| 'var'
	| 'string'
	| 'pair'
	| 'binary'

class Parser extends EventEmitter {
	public packet: Packet

	public error: Error | null

	public settings: ParserSettings

	private _list: BufferList

	private _states: string[]

	private _stateCounter: number

	private _pos: number

	constructor() {
		super()
		this.packet = new Packet()
		this.error = null
		this._list = bl()
		this._stateCounter = 0
		this._pos = 0
		this.settings = {}
		this._states = [
			'_parseHeader',
			'_parseLength',
			'_parsePayload',
			'_newPacket',
		]
	}

	// Static factory method
	static parser(opt?: ParserSettings): Parser {
		if (!(this instanceof Parser)) return new Parser().parser(opt)

		const instance = this as unknown as Parser
		instance.settings = opt || {}
		instance._resetState()
		return instance
	}

	// Instance method version of parser
	parser(opt?: ParserSettings): Parser {
		this.settings = opt || {}
		this._resetState()
		return this
	}

	private _resetState(): void {
		debugLog(
			'_resetState: resetting packet, error, _list, and _stateCounter',
		)
		this.packet = new Packet()
		this.error = null
		this._list = bl()
		this._stateCounter = 0
	}

	parse(buf: Buffer): number {
		if (this.error) this._resetState()

		this._list.append(buf)
		debugLog('parse: current state: %s', this._states[this._stateCounter])

		while (
			(this.packet.length !== -1 || this._list.length > 0) &&
			// Using type assertion because TypeScript doesn't know that this[state] is callable
			(this as any)[this._states[this._stateCounter]]() &&
			!this.error
		) {
			this._stateCounter++
			debugLog(
				'parse: state complete. _stateCounter is now: %d',
				this._stateCounter,
			)
			debugLog(
				'parse: packet.length: %d, buffer list length: %d',
				this.packet.length,
				this._list.length,
			)
			if (this._stateCounter >= this._states.length)
				this._stateCounter = 0
		}

		debugLog(
			'parse: exited while loop. packet: %d, buffer list length: %d',
			this.packet.length,
			this._list.length,
		)
		return this._list.length
	}

	private _parseHeader(): boolean {
		// There is at least one byte in the buffer
		const zero = this._list.readUInt8(0)
		const cmdIndex = zero >> constants.CMD_SHIFT
		this.packet.cmd = constants.types[cmdIndex]
		const headerFlags = zero & 0xf
		const requiredHeaderFlags = constants.requiredHeaderFlags[cmdIndex]

		if (
			requiredHeaderFlags != null &&
			headerFlags !== requiredHeaderFlags
		) {
			// Where a flag bit is marked as "Reserved" in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
			return this._emitError(
				new Error(constants.requiredHeaderFlagsErrors[cmdIndex]),
			)
		}

		this.packet.retain = (zero & constants.RETAIN_MASK) !== 0
		this.packet.qos = (zero >> constants.QOS_SHIFT) & constants.QOS_MASK

		if (this.packet.qos > 2) {
			return this._emitError(
				new Error('Packet must not have both QoS bits set to 1'),
			)
		}

		this.packet.dup = (zero & constants.DUP_MASK) !== 0
		debugLog('_parseHeader: packet: %o', this.packet)

		this._list.consume(1)

		return true
	}

	private _parseLength(): boolean {
		// There is at least one byte in the list
		const result = this._parseVarByteNum(true)

		if (result) {
			this.packet.length = result.value
			this._list.consume(result.bytes)
		}

		debugLog('_parseLength %d', result.value)
		return !!result
	}

	private _parsePayload(): boolean {
		debugLog('_parsePayload: payload %O', this._list)
		let result = false

		// Do we have a payload? Do we have enough data to complete the payload?
		// PINGs have no payload
		if (
			this.packet.length === 0 ||
			this._list.length >= this.packet.length
		) {
			this._pos = 0

			switch (this.packet.cmd) {
				case 'connect':
					this._parseConnect()
					break
				case 'connack':
					this._parseConnack()
					break
				case 'publish':
					this._parsePublish()
					break
				case 'puback':
				case 'pubrec':
				case 'pubrel':
				case 'pubcomp':
					this._parseConfirmation()
					break
				case 'subscribe':
					this._parseSubscribe()
					break
				case 'suback':
					this._parseSuback()
					break
				case 'unsubscribe':
					this._parseUnsubscribe()
					break
				case 'unsuback':
					this._parseUnsuback()
					break
				case 'pingreq':
				case 'pingresp':
					// These are empty, nothing to do
					break
				case 'disconnect':
					this._parseDisconnect()
					break
				case 'auth':
					this._parseAuth()
					break
				default:
					this._emitError(new Error('Not supported'))
			}

			result = true
		}

		debugLog('_parsePayload complete result: %s', result)
		return result
	}

	private _parseConnect(): Packet | void {
		debugLog('_parseConnect')
		let topic: string // Will topic
		let payload: Buffer // Will payload
		let password: Buffer // Password
		let username: string // Username
		const flags: { [key: string]: boolean } = {}
		const packet = this.packet

		// Parse protocolId
		const protocolId = this._parseString()

		if (protocolId === null)
			return this._emitError(new Error('Cannot parse protocolId'))
		if (protocolId !== 'MQTT' && protocolId !== 'MQIsdp') {
			return this._emitError(new Error('Invalid protocolId'))
		}

		packet.protocolId = protocolId

		// Parse constants version number
		if (this._pos >= this._list.length)
			return this._emitError(new Error('Packet too short'))

		packet.protocolVersion = this._list.readUInt8(this._pos)

		if (packet.protocolVersion >= 128) {
			packet.bridgeMode = true
			packet.protocolVersion -= 128
		}

		if (
			packet.protocolVersion !== 3 &&
			packet.protocolVersion !== 4 &&
			packet.protocolVersion !== 5
		) {
			return this._emitError(new Error('Invalid protocol version'))
		}

		this._pos++

		if (this._pos >= this._list.length) {
			return this._emitError(new Error('Packet too short'))
		}

		if (this._list.readUInt8(this._pos) & 0x1) {
			// The Server MUST validate that the reserved flag in the CONNECT Control Packet is set to zero and disconnect the Client if it is not zero [MQTT-3.1.2-3]
			return this._emitError(
				new Error('Connect flag bit 0 must be 0, but got 1'),
			)
		}

		// Parse connect flags
		flags.username =
			(this._list.readUInt8(this._pos) & constants.USERNAME_MASK) !== 0
		flags.password =
			(this._list.readUInt8(this._pos) & constants.PASSWORD_MASK) !== 0
		flags.will =
			(this._list.readUInt8(this._pos) & constants.WILL_FLAG_MASK) !== 0

		const willRetain = !!(
			this._list.readUInt8(this._pos) & constants.WILL_RETAIN_MASK
		)
		const willQos =
			(this._list.readUInt8(this._pos) & constants.WILL_QOS_MASK) >>
			constants.WILL_QOS_SHIFT

		if (flags.will) {
			packet.will = {}
			packet.will.retain = willRetain
			packet.will.qos = willQos
		} else {
			if (willRetain) {
				return this._emitError(
					new Error(
						'Will Retain Flag must be set to zero when Will Flag is set to 0',
					),
				)
			}
			if (willQos) {
				return this._emitError(
					new Error(
						'Will QoS must be set to zero when Will Flag is set to 0',
					),
				)
			}
		}

		packet.clean =
			(this._list.readUInt8(this._pos) & constants.CLEAN_SESSION_MASK) !==
			0
		this._pos++

		// Parse keepalive
		packet.keepalive = this._parseNum()
		if (packet.keepalive === -1)
			return this._emitError(new Error('Packet too short'))

		// parse properties
		if (packet.protocolVersion === 5) {
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
		}

		// Parse clientId
		const clientId = this._parseString()
		if (clientId === null)
			return this._emitError(new Error('Packet too short'))
		packet.clientId = clientId
		debugLog('_parseConnect: packet.clientId: %s', packet.clientId)

		if (flags.will) {
			if (packet.protocolVersion === 5) {
				const willProperties = this._parseProperties()
				if (Object.getOwnPropertyNames(willProperties).length) {
					packet.will.properties = willProperties
				}
			}
			// Parse will topic
			topic = this._parseString()
			if (topic === null)
				return this._emitError(new Error('Cannot parse will topic'))
			packet.will.topic = topic
			debugLog('_parseConnect: packet.will.topic: %s', packet.will.topic)

			// Parse will payload
			payload = this._parseBuffer()
			if (payload === null)
				return this._emitError(new Error('Cannot parse will payload'))
			packet.will.payload = payload
			debugLog(
				'_parseConnect: packet.will.paylaod: %s',
				packet.will.payload,
			)
		}

		// Parse username
		if (flags.username) {
			username = this._parseString()
			if (username === null)
				return this._emitError(new Error('Cannot parse username'))
			packet.username = username
			debugLog('_parseConnect: packet.username: %s', packet.username)
		}

		// Parse password
		if (flags.password) {
			password = this._parseBuffer()
			if (password === null)
				return this._emitError(new Error('Cannot parse password'))
			packet.password = password
		}

		// need for right parse auth packet and self set up
		this.settings = packet
		debugLog('_parseConnect: complete')
		return packet
	}

	private _parseConnack(): void {
		debugLog('_parseConnack')
		const packet = this.packet

		if (this._list.length < 1) return null
		const flags = this._list.readUInt8(this._pos++)
		if (flags > 1) {
			return this._emitError(
				new Error('Invalid connack flags, bits 7-1 must be set to 0'),
			)
		}
		packet.sessionPresent = !!(flags & constants.SESSIONPRESENT_MASK)

		if (this.settings.protocolVersion === 5) {
			if (this._list.length >= 2) {
				packet.reasonCode = this._list.readUInt8(this._pos++)
			} else {
				packet.reasonCode = 0
			}
		} else {
			if (this._list.length < 2) return null
			packet.returnCode = this._list.readUInt8(this._pos++)
		}

		if (packet.returnCode === -1 || packet.reasonCode === -1)
			return this._emitError(new Error('Cannot parse return code'))
		// mqtt 5 properties
		if (this.settings.protocolVersion === 5) {
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
		}
		debugLog('_parseConnack: complete')
	}

	private _parsePublish(): void {
		debugLog('_parsePublish')
		const packet = this.packet
		packet.topic = this._parseString()

		if (packet.topic === null)
			return this._emitError(new Error('Cannot parse topic'))

		// Parse messageId
		if (packet.qos > 0)
			if (!this._parseMessageId()) {
				return
			}

		// Properties mqtt 5
		if (this.settings.protocolVersion === 5) {
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
		}

		packet.payload = this._list.slice(this._pos, packet.length)
		debugLog('_parsePublish: payload from buffer list: %o', packet.payload)
	}

	private _parseSubscribe(): void {
		debugLog('_parseSubscribe')
		const packet = this.packet
		let topic: string
		let options: number
		let qos: number
		let rh: number
		let rap: boolean
		let nl: boolean
		let subscription: any

		packet.subscriptions = []

		if (!this._parseMessageId()) {
			return
		}

		// Properties mqtt 5
		if (this.settings.protocolVersion === 5) {
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
		}

		if (packet.length <= 0) {
			return this._emitError(
				new Error('Malformed subscribe, no payload specified'),
			)
		}

		while (this._pos < packet.length) {
			// Parse topic
			topic = this._parseString()
			if (topic === null)
				return this._emitError(new Error('Cannot parse topic'))
			if (this._pos >= packet.length)
				return this._emitError(new Error('Malformed Subscribe Payload'))

			options = this._parseByte()

			if (this.settings.protocolVersion === 5) {
				if (options & 0xc0) {
					return this._emitError(
						new Error(
							'Invalid subscribe topic flag bits, bits 7-6 must be 0',
						),
					)
				}
			} else if (options & 0xfc) {
				return this._emitError(
					new Error(
						'Invalid subscribe topic flag bits, bits 7-2 must be 0',
					),
				)
			}

			qos = options & constants.SUBSCRIBE_OPTIONS_QOS_MASK
			if (qos > 2) {
				return this._emitError(
					new Error('Invalid subscribe QoS, must be <= 2'),
				)
			}
			nl =
				((options >> constants.SUBSCRIBE_OPTIONS_NL_SHIFT) &
					constants.SUBSCRIBE_OPTIONS_NL_MASK) !==
				0
			rap =
				((options >> constants.SUBSCRIBE_OPTIONS_RAP_SHIFT) &
					constants.SUBSCRIBE_OPTIONS_RAP_MASK) !==
				0
			rh =
				(options >> constants.SUBSCRIBE_OPTIONS_RH_SHIFT) &
				constants.SUBSCRIBE_OPTIONS_RH_MASK

			if (rh > 2) {
				return this._emitError(
					new Error('Invalid retain handling, must be <= 2'),
				)
			}

			subscription = { topic, qos }

			// mqtt 5 options
			if (this.settings.protocolVersion === 5) {
				subscription.nl = nl
				subscription.rap = rap
				subscription.rh = rh
			} else if (this.settings.bridgeMode) {
				subscription.rh = 0
				subscription.rap = true
				subscription.nl = true
			}

			// Push pair to subscriptions
			debugLog(
				'_parseSubscribe: push subscription `%s` to subscription',
				subscription,
			)
			packet.subscriptions.push(subscription)
		}
	}

	private _parseSuback(): void {
		debugLog('_parseSuback')
		const packet = this.packet
		this.packet.granted = []

		if (!this._parseMessageId()) {
			return
		}

		// Properties mqtt 5
		if (this.settings.protocolVersion === 5) {
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
		}

		if (packet.length <= 0) {
			return this._emitError(
				new Error('Malformed suback, no payload specified'),
			)
		}

		// Parse granted QoSes
		while (this._pos < this.packet.length) {
			const code = this._list.readUInt8(this._pos++)
			if (this.settings.protocolVersion === 5) {
				if (!constants.MQTT5_SUBACK_CODES[code]) {
					return this._emitError(new Error('Invalid suback code'))
				}
			} else if (code > 2 && code !== 0x80) {
				return this._emitError(
					new Error('Invalid suback QoS, must be 0, 1, 2 or 128'),
				)
			}
			this.packet.granted.push(code)
		}
	}

	private _parseUnsubscribe(): void {
		debugLog('_parseUnsubscribe')
		const packet = this.packet

		packet.unsubscriptions = []

		// Parse messageId
		if (!this._parseMessageId()) {
			return
		}

		// Properties mqtt 5
		if (this.settings.protocolVersion === 5) {
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
		}

		if (packet.length <= 0) {
			return this._emitError(
				new Error('Malformed unsubscribe, no payload specified'),
			)
		}

		while (this._pos < packet.length) {
			// Parse topic
			const topic = this._parseString()
			if (topic === null)
				return this._emitError(new Error('Cannot parse topic'))

			// Push topic to unsubscriptions
			debugLog(
				'_parseUnsubscribe: push topic `%s` to unsubscriptions',
				topic,
			)
			packet.unsubscriptions.push(topic)
		}
	}

	private _parseUnsuback(): void {
		debugLog('_parseUnsuback')
		const packet = this.packet
		if (!this._parseMessageId())
			return this._emitError(new Error('Cannot parse messageId'))

		if (
			(this.settings.protocolVersion === 3 ||
				this.settings.protocolVersion === 4) &&
			packet.length !== 2
		) {
			return this._emitError(
				new Error('Malformed unsuback, payload length must be 2'),
			)
		}
		if (packet.length <= 0) {
			return this._emitError(
				new Error('Malformed unsuback, no payload specified'),
			)
		}

		// Properties mqtt 5
		if (this.settings.protocolVersion === 5) {
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
			// Parse granted QoSes
			packet.granted = []

			while (this._pos < this.packet.length) {
				const code = this._list.readUInt8(this._pos++)
				if (!constants.MQTT5_UNSUBACK_CODES[code]) {
					return this._emitError(new Error('Invalid unsuback code'))
				}
				this.packet.granted.push(code)
			}
		}
	}

	// parse packets like puback, pubrec, pubrel, pubcomp
	private _parseConfirmation(): boolean {
		debugLog('_parseConfirmation: packet.cmd: `%s`', this.packet.cmd)
		const packet = this.packet

		this._parseMessageId()

		if (this.settings.protocolVersion === 5) {
			if (packet.length > 2) {
				// response code
				packet.reasonCode = this._parseByte()
				switch (this.packet.cmd) {
					case 'puback':
					case 'pubrec':
						if (
							!constants.MQTT5_PUBACK_PUBREC_CODES[
								packet.reasonCode
							]
						) {
							return this._emitError(
								new Error(
									`Invalid ${this.packet.cmd} reason code`,
								),
							)
						}
						break
					case 'pubrel':
					case 'pubcomp':
						if (
							!constants.MQTT5_PUBREL_PUBCOMP_CODES[
								packet.reasonCode
							]
						) {
							return this._emitError(
								new Error(
									`Invalid ${this.packet.cmd} reason code`,
								),
							)
						}
						break
				}
				debugLog(
					'_parseConfirmation: packet.reasonCode `%d`',
					packet.reasonCode,
				)
			} else {
				packet.reasonCode = 0
			}

			if (packet.length > 3) {
				// properies mqtt 5
				const properties = this._parseProperties()
				if (Object.getOwnPropertyNames(properties).length) {
					packet.properties = properties
				}
			}
		}

		return true
	}

	// parse disconnect packet
	private _parseDisconnect(): boolean {
		const packet = this.packet
		debugLog('_parseDisconnect')

		if (this.settings.protocolVersion === 5) {
			// response code
			if (this._list.length > 0) {
				packet.reasonCode = this._parseByte()
				if (!constants.MQTT5_DISCONNECT_CODES[packet.reasonCode]) {
					this._emitError(new Error('Invalid disconnect reason code'))
				}
			} else {
				packet.reasonCode = 0
			}
			// properies mqtt 5
			const properties = this._parseProperties()
			if (Object.getOwnPropertyNames(properties).length) {
				packet.properties = properties
			}
		}

		debugLog('_parseDisconnect result: true')
		return true
	}

	// parse auth packet
	private _parseAuth(): boolean {
		debugLog('_parseAuth')
		const packet = this.packet

		if (this.settings.protocolVersion !== 5) {
			return this._emitError(
				new Error('Not supported auth packet for this version MQTT'),
			)
		}

		// response code
		packet.reasonCode = this._parseByte()
		if (!constants.MQTT5_AUTH_CODES[packet.reasonCode]) {
			return this._emitError(new Error('Invalid auth reason code'))
		}
		// properies mqtt 5
		const properties = this._parseProperties()
		if (Object.getOwnPropertyNames(properties).length) {
			packet.properties = properties
		}

		debugLog('_parseAuth: result: true')
		return true
	}

	private _parseMessageId(): boolean {
		const packet = this.packet

		packet.messageId = this._parseNum()

		if (packet.messageId === null) {
			this._emitError(new Error('Cannot parse messageId'))
			return false
		}

		debugLog('_parseMessageId: packet.messageId %d', packet.messageId)
		return true
	}

	private _parseString(maybeBuffer?: boolean): string | null {
		const length = this._parseNum()
		const end = length + this._pos

		if (
			length === -1 ||
			end > this._list.length ||
			end > this.packet.length
		)
			return null

		const result = this._list.toString('utf8', this._pos, end)
		this._pos += length
		debugLog('_parseString: result: %s', result)
		return result
	}

	private _parseStringPair(): StringPair | null {
		debugLog('_parseStringPair')
		const name = this._parseString()
		const value = this._parseString()

		if (name === null || value === null) return null

		return { name, value }
	}

	private _parseBuffer(): Buffer | null {
		const length = this._parseNum()
		const end = length + this._pos

		if (
			length === -1 ||
			end > this._list.length ||
			end > this.packet.length
		)
			return null

		const result = this._list.slice(this._pos, end)

		this._pos += length
		debugLog('_parseBuffer: result: %o', result)
		return result
	}

	private _parseNum(): number {
		if (this._list.length - this._pos < 2) return -1

		const result = this._list.readUInt16BE(this._pos)
		this._pos += 2
		debugLog('_parseNum: result: %s', result)
		return result
	}

	private _parse4ByteNum(): number {
		if (this._list.length - this._pos < 4) return -1

		const result = this._list.readUInt32BE(this._pos)
		this._pos += 4
		debugLog('_parse4ByteNum: result: %s', result)
		return result
	}

	private _parseVarByteNum(
		fullInfoFlag?: boolean,
	): ParseVarByteNumResult | number | false {
		debugLog('_parseVarByteNum')
		const maxBytes = 4
		let bytes = 0
		let mul = 1
		let value = 0
		let result: ParseVarByteNumResult | number | false = false
		let current: number
		const padding = this._pos ? this._pos : 0

		while (bytes < maxBytes && padding + bytes < this._list.length) {
			current = this._list.readUInt8(padding + bytes++)
			value += mul * (current & constants.VARBYTEINT_MASK)
			mul *= 0x80

			if ((current & constants.VARBYTEINT_FIN_MASK) === 0) {
				result = true
				break
			}
			if (this._list.length <= bytes) {
				break
			}
		}

		if (!result && bytes === maxBytes && this._list.length >= bytes) {
			this._emitError(new Error('Invalid variable byte integer'))
		}

		if (padding) {
			this._pos += bytes
		}

		if (result) {
			if (fullInfoFlag) {
				result = { bytes, value }
			} else {
				result = value
			}
		} else {
			result = false
		}

		debugLog('_parseVarByteNum: result: %o', result)
		return result
	}

	private _parseByte(): number {
		let result: number
		if (this._pos < this._list.length) {
			result = this._list.readUInt8(this._pos)
			this._pos++
		}
		debugLog('_parseByte: result: %o', result)
		return result
	}

	private _parseByType(type: PropertyTypes): any {
		debugLog('_parseByType: type: %s', type)
		switch (type) {
			case 'byte': {
				return this._parseByte() !== 0
			}
			case 'int8': {
				return this._parseByte()
			}
			case 'int16': {
				return this._parseNum()
			}
			case 'int32': {
				return this._parse4ByteNum()
			}
			case 'var': {
				return this._parseVarByteNum()
			}
			case 'string': {
				return this._parseString()
			}
			case 'pair': {
				return this._parseStringPair()
			}
			case 'binary': {
				return this._parseBuffer()
			}
		}
	}

	private _parseProperties(): Record<string, any> {
		debugLog('_parseProperties')
		const length = this._parseVarByteNum() as number
		const start = this._pos
		const end = start + length
		const result: Record<string, any> = {}

		while (this._pos < end) {
			const type = this._parseByte()
			if (!type) {
				this._emitError(new Error('Cannot parse property code type'))
				return {}
			}
			const name = constants.propertiesCodes[type]
			if (!name) {
				this._emitError(new Error('Unknown property'))
				return {}
			}
			// user properties process
			if (name === 'userProperties') {
				if (!result[name]) {
					result[name] = Object.create(null)
				}
				const currentUserProperty = this._parseByType(
					constants.propertiesTypes[name],
				)
				if (result[name][currentUserProperty.name]) {
					if (Array.isArray(result[name][currentUserProperty.name])) {
						result[name][currentUserProperty.name].push(
							currentUserProperty.value,
						)
					} else {
						const currentValue =
							result[name][currentUserProperty.name]
						result[name][currentUserProperty.name] = [currentValue]
						result[name][currentUserProperty.name].push(
							currentUserProperty.value,
						)
					}
				} else {
					result[name][currentUserProperty.name] =
						currentUserProperty.value
				}
				continue
			}
			if (result[name]) {
				if (Array.isArray(result[name])) {
					result[name].push(
						this._parseByType(constants.propertiesTypes[name]),
					)
				} else {
					result[name] = [result[name]]
					result[name].push(
						this._parseByType(constants.propertiesTypes[name]),
					)
				}
			} else {
				result[name] = this._parseByType(
					constants.propertiesTypes[name],
				)
			}
		}
		return result
	}

	private _newPacket(): boolean {
		debugLog('_newPacket')
		if (this.packet) {
			this._list.consume(this.packet.length)
			debugLog(
				'_newPacket: parser emit packet: packet.cmd: %s, packet.payload: %s, packet.length: %d',
				this.packet.cmd,
				this.packet.payload,
				this.packet.length,
			)
			this.emit('packet', this.packet)
		}
		debugLog('_newPacket: new packet')
		this.packet = new Packet()

		this._pos = 0

		return true
	}

	private _emitError(err: Error): boolean {
		debugLog('_emitError', err)
		this.error = err
		this.emit('error', err)
		return false
	}
}

export default Parser
