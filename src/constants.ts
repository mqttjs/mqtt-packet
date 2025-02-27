import { Buffer } from 'buffer'

/* Command code => mnemonic */
export const types: Record<number, string> = {
	0: 'reserved',
	1: 'connect',
	2: 'connack',
	3: 'publish',
	4: 'puback',
	5: 'pubrec',
	6: 'pubrel',
	7: 'pubcomp',
	8: 'subscribe',
	9: 'suback',
	10: 'unsubscribe',
	11: 'unsuback',
	12: 'pingreq',
	13: 'pingresp',
	14: 'disconnect',
	15: 'auth',
}

export const requiredHeaderFlags: Record<number, number> = {
	1: 0, // 'connect'
	2: 0, // 'connack'
	4: 0, // 'puback'
	5: 0, // 'pubrec'
	6: 2, // 'pubrel'
	7: 0, // 'pubcomp'
	8: 2, // 'subscribe'
	9: 0, // 'suback'
	10: 2, // 'unsubscribe'
	11: 0, // 'unsuback'
	12: 0, // 'pingreq'
	13: 0, // 'pingresp'
	14: 0, // 'disconnect'
	15: 0, // 'auth'
}

export const requiredHeaderFlagsErrors: Record<number, string> =
	Object.fromEntries(
		Object.entries(requiredHeaderFlags).map(([k, v]) => [
			Number(k),
			`Invalid header flag bits, must be 0x${v.toString(16)} for ${types[Number(k)]} packet`,
		]),
	)

/* Mnemonic => Command code */
export const codes: Record<string, number> = Object.fromEntries(
	Object.entries(types).map(([k, v]) => [v, Number(k)]),
)

/* Header */
export const CMD_SHIFT = 4

export const CMD_MASK = 0xf0

export const DUP_MASK = 0x08

export const QOS_MASK = 0x03

export const QOS_SHIFT = 1

export const RETAIN_MASK = 0x01

/* Length */
export const VARBYTEINT_MASK = 0x7f

export const VARBYTEINT_FIN_MASK = 0x80

export const VARBYTEINT_MAX = 268435455

/* Connack */
export const SESSIONPRESENT_MASK = 0x01

export const SESSIONPRESENT_HEADER = Buffer.from([SESSIONPRESENT_MASK])

export const CONNACK_HEADER = Buffer.from([codes.connack << CMD_SHIFT])

/* Connect */
export const USERNAME_MASK = 0x80

export const PASSWORD_MASK = 0x40

export const WILL_RETAIN_MASK = 0x20

export const WILL_QOS_MASK = 0x18

export const WILL_QOS_SHIFT = 3

export const WILL_FLAG_MASK = 0x04

export const CLEAN_SESSION_MASK = 0x02

export const CONNECT_HEADER = Buffer.from([codes.connect << CMD_SHIFT])

/* Properties */
export const properties: Record<string, number> = {
	sessionExpiryInterval: 17,
	willDelayInterval: 24,
	receiveMaximum: 33,
	maximumPacketSize: 39,
	topicAliasMaximum: 34,
	requestResponseInformation: 25,
	requestProblemInformation: 23,
	userProperties: 38,
	authenticationMethod: 21,
	authenticationData: 22,
	payloadFormatIndicator: 1,
	messageExpiryInterval: 2,
	contentType: 3,
	responseTopic: 8,
	correlationData: 9,
	maximumQoS: 36,
	retainAvailable: 37,
	assignedClientIdentifier: 18,
	reasonString: 31,
	wildcardSubscriptionAvailable: 40,
	subscriptionIdentifiersAvailable: 41,
	sharedSubscriptionAvailable: 42,
	serverKeepAlive: 19,
	responseInformation: 26,
	serverReference: 28,
	topicAlias: 35,
	subscriptionIdentifier: 11,
}

export const propertiesCodes: Record<number, string> = Object.fromEntries(
	Object.entries(properties).map(([prop, id]) => [id, prop]),
)

export const propertiesTypes: Record<string, string> = {
	sessionExpiryInterval: 'int32',
	willDelayInterval: 'int32',
	receiveMaximum: 'int16',
	maximumPacketSize: 'int32',
	topicAliasMaximum: 'int16',
	requestResponseInformation: 'byte',
	requestProblemInformation: 'byte',
	userProperties: 'pair',
	authenticationMethod: 'string',
	authenticationData: 'binary',
	payloadFormatIndicator: 'byte',
	messageExpiryInterval: 'int32',
	contentType: 'string',
	responseTopic: 'string',
	correlationData: 'binary',
	maximumQoS: 'int8',
	retainAvailable: 'byte',
	assignedClientIdentifier: 'string',
	reasonString: 'string',
	wildcardSubscriptionAvailable: 'byte',
	subscriptionIdentifiersAvailable: 'byte',
	sharedSubscriptionAvailable: 'byte',
	serverKeepAlive: 'int16',
	responseInformation: 'string',
	serverReference: 'string',
	topicAlias: 'int16',
	subscriptionIdentifier: 'var',
}

export const genHeader = (type: string): Buffer[][][] => {
	return [0, 1, 2].map((qos) =>
		[0, 1].map((dup) =>
			[0, 1].map((retain) => {
				const buf = Buffer.alloc(1)
				buf.writeUInt8(
					(codes[type] << CMD_SHIFT) |
						(dup ? DUP_MASK : 0) |
						(qos << QOS_SHIFT) |
						retain,
					0,
					// true,
				)
				return buf
			}),
		),
	)
}

/* Publish */
export const PUBLISH_HEADER = genHeader('publish')

/* Subscribe */
export const SUBSCRIBE_HEADER = genHeader('subscribe')

/* Unsubscribe */
export const UNSUBSCRIBE_HEADER = genHeader('unsubscribe')

/* Confirmations */
export const ACKS = {
	unsuback: genHeader('unsuback'),
	puback: genHeader('puback'),
	pubcomp: genHeader('pubcomp'),
	pubrel: genHeader('pubrel'),
	pubrec: genHeader('pubrec'),
}

export const SUBACK_HEADER = Buffer.from([codes.suback << CMD_SHIFT])

/* Protocol versions */
export const VERSION3 = Buffer.from([3])

export const VERSION4 = Buffer.from([4])

export const VERSION5 = Buffer.from([5])

export const VERSION131 = Buffer.from([131])

export const VERSION132 = Buffer.from([132])

/* QoS */
export const QOS = [0, 1, 2].map((qos) => {
	return Buffer.from([qos])
})

/* Empty packets */
export const EMPTY = {
	pingreq: Buffer.from([codes.pingreq << 4, 0]),
	pingresp: Buffer.from([codes.pingresp << 4, 0]),
	disconnect: Buffer.from([codes.disconnect << 4, 0]),
}

export const MQTT5_CONNACK_CODES = {
	0x00: 'Success',
	0x10: 'No matching subscribers',
	0x80: 'Unspecified error',
	0x83: 'Implementation specific error',
	0x87: 'Not authorized',
	0x90: 'Topic Name invalid',
	0x91: 'Packet identifier in use',
	0x97: 'Quota exceeded',
	0x99: 'Payload format invalid',
}

export const MQTT5_PUBREL_PUBCOMP_CODES = {
	0x00: 'Success',
	0x92: 'Packet Identifier not found',
}

export const MQTT5_SUBACK_CODES = {
	0x00: 'Granted QoS 0',
	0x01: 'Granted QoS 1',
	0x02: 'Granted QoS 2',
	0x80: 'Unspecified error',
	0x83: 'Implementation specific error',
	0x87: 'Not authorized',
	0x8f: 'Topic Filter invalid',
	0x91: 'Packet Identifier in use',
	0x97: 'Quota exceeded',
	0x9e: 'Shared Subscriptions not supported',
	0xa1: 'Subscription Identifiers not supported',
	0xa2: 'Wildcard Subscriptions not supported',
}

export const MQTT5_UNSUBACK_CODES = {
	0x00: 'Success',
	0x11: 'No subscription existed',
	0x80: 'Unspecified error',
	0x83: 'Implementation specific error',
	0x87: 'Not authorized',
	0x8f: 'Topic Filter invalid',
	0x91: 'Packet Identifier in use',
}

export const MQTT5_DISCONNECT_CODES = {
	0x00: 'Normal disconnection',
	0x04: 'Disconnect with Will Message',
	0x80: 'Unspecified error',
	0x81: 'Malformed Packet',
	0x82: 'Protocol Error',
	0x83: 'Implementation specific error',
	0x87: 'Not authorized',
	0x89: 'Server busy',
	0x8b: 'Server shutting down',
	0x8d: 'Keep Alive timeout',
	0x8e: 'Session taken over',
	0x8f: 'Topic Filter invalid',
	0x90: 'Topic Name invalid',
	0x93: 'Receive Maximum exceeded',
	0x94: 'Topic Alias invalid',
	0x95: 'Packet too large',
	0x96: 'Message rate too high',
	0x97: 'Quota exceeded',
	0x98: 'Administrative action',
	0x99: 'Payload format invalid',
	0x9a: 'Retain not supported',
	0x9b: 'QoS not supported',
	0x9c: 'Use another server',
	0x9d: 'Server moved',
	0x9e: 'Shared Subscriptions not supported',
	0x9f: 'Connection rate exceeded',
	0xa0: 'Maximum connect time',
	0xa1: 'Subscription Identifiers not supported',
	0xa2: 'Wildcard Subscriptions not supported',
}

export const MQTT5_AUTH_CODES = {
	0x00: 'Success',
	0x18: 'Continue authentication',
	0x19: 'Re-authenticate',
}
