import EventEmitter from 'events'

export type QoS = 0 | 1 | 2

export type PacketCmd =
	| 'auth'
	| 'connack'
	| 'connect'
	| 'disconnect'
	| 'pingreq'
	| 'pingresp'
	| 'puback'
	| 'pubcomp'
	| 'publish'
	| 'pubrel'
	| 'pubrec'
	| 'suback'
	| 'subscribe'
	| 'unsuback'
	| 'unsubscribe'

export type UserProperties = { [index: string]: string | string[] }

export interface IPacket {
	cmd: PacketCmd
	messageId?: number
	length?: number
}

export interface IAuthPacket extends IPacket {
	cmd: 'auth'
	reasonCode: number
	properties?: {
		authenticationMethod?: string
		authenticationData?: Buffer
		reasonString?: string
		userProperties?: UserProperties
	}
}

export interface IConnectPacket extends IPacket {
	cmd: 'connect'
	clientId: string
	protocolVersion?: 131 | 132 | 4 | 5 | 3
	protocolId?: 'MQTT' | 'MQIsdp'
	clean?: boolean
	keepalive?: number
	username?: string
	password?: Buffer
	will?: {
		topic: string
		payload: Buffer | string
		qos?: QoS
		retain?: boolean
		properties?: {
			willDelayInterval?: number
			payloadFormatIndicator?: boolean
			messageExpiryInterval?: number
			contentType?: string
			responseTopic?: string
			correlationData?: Buffer
			userProperties?: UserProperties
		}
	}
	properties?: {
		sessionExpiryInterval?: number
		receiveMaximum?: number
		maximumPacketSize?: number
		topicAliasMaximum?: number
		requestResponseInformation?: boolean
		requestProblemInformation?: boolean
		userProperties?: UserProperties
		authenticationMethod?: string
		authenticationData?: Buffer
	}
}

export interface IPublishPacket extends IPacket {
	cmd: 'publish'
	qos: QoS
	dup: boolean
	retain: boolean
	topic: string
	payload: string | Buffer
	properties?: {
		payloadFormatIndicator?: boolean
		messageExpiryInterval?: number
		topicAlias?: number
		responseTopic?: string
		correlationData?: Buffer
		userProperties?: UserProperties
		subscriptionIdentifier?: number | number[]
		contentType?: string
	}
}

export interface IConnackPacket extends IPacket {
	cmd: 'connack'
	returnCode?: number
	reasonCode?: number
	sessionPresent: boolean
	properties?: {
		sessionExpiryInterval?: number
		receiveMaximum?: number
		maximumQoS?: number
		retainAvailable?: boolean
		maximumPacketSize?: number
		assignedClientIdentifier?: string
		topicAliasMaximum?: number
		reasonString?: string
		userProperties?: UserProperties
		wildcardSubscriptionAvailable?: boolean
		subscriptionIdentifiersAvailable?: boolean
		sharedSubscriptionAvailable?: boolean
		serverKeepAlive?: number
		responseInformation?: string
		serverReference?: string
		authenticationMethod?: string
		authenticationData?: Buffer
	}
}

export interface ISubscription {
	topic: string
	qos: QoS
	nl?: boolean
	rap?: boolean
	rh?: number
}

export interface ISubscribePacket extends IPacket {
	cmd: 'subscribe'
	subscriptions: ISubscription[]
	properties?: {
		reasonString?: string
		subscriptionIdentifier?: number
		userProperties?: UserProperties
	}
}

export interface ISubackPacket extends IPacket {
	cmd: 'suback'
	reasonCode?: number
	properties?: {
		reasonString?: string
		userProperties?: UserProperties
	}
	granted: number[] | Record<string, number>
}

export interface IUnsubscribePacket extends IPacket {
	cmd: 'unsubscribe'
	properties?: {
		reasonString?: string
		userProperties?: UserProperties
	}
	unsubscriptions: string[]
}

export interface IUnsubackPacket extends IPacket {
	cmd: 'unsuback'
	reasonCode?: number
	properties?: {
		reasonString?: string
		userProperties?: UserProperties
	}
	granted: number[]
}

export interface IPubackPacket extends IPacket {
	cmd: 'puback'
	reasonCode?: number
	properties?: {
		reasonString?: string
		userProperties?: UserProperties
	}
}

export interface IPubcompPacket extends IPacket {
	cmd: 'pubcomp'
	reasonCode?: number
	properties?: {
		reasonString?: string
		userProperties?: UserProperties
	}
}

export interface IPubrelPacket extends IPacket {
	cmd: 'pubrel'
	reasonCode?: number
	properties?: {
		reasonString?: string
		userProperties?: UserProperties
	}
}

export interface IPubrecPacket extends IPacket {
	cmd: 'pubrec'
	reasonCode?: number
	properties?: {
		reasonString?: string
		userProperties?: UserProperties
	}
}

export interface IPingreqPacket extends IPacket {
	cmd: 'pingreq'
}

export interface IPingrespPacket extends IPacket {
	cmd: 'pingresp'
}

export interface IDisconnectPacket extends IPacket {
	cmd: 'disconnect'
	reasonCode?: number
	properties?: {
		sessionExpiryInterval?: number
		reasonString?: string
		userProperties?: UserProperties
		serverReference?: string
	}
}

export type AckPacket =
	| IPubackPacket
	| IPubcompPacket
	| IPubrelPacket
	| IPubrecPacket

export type PacketWithProperties =
	| IConnectPacket
	| IPublishPacket
	| IConnackPacket
	| ISubscribePacket
	| ISubackPacket
	| IUnsubscribePacket
	| IUnsubackPacket
	| IPubackPacket
	| IPubcompPacket
	| IPubrelPacket
	| IDisconnectPacket
	| IPubrecPacket
	| IAuthPacket

export type Packet =
	| IConnectPacket
	| IPublishPacket
	| IConnackPacket
	| ISubscribePacket
	| ISubackPacket
	| IUnsubscribePacket
	| IUnsubackPacket
	| IPubackPacket
	| IPubcompPacket
	| IPubrelPacket
	| IPingreqPacket
	| IPingrespPacket
	| IDisconnectPacket
	| IPubrecPacket
	| IAuthPacket
