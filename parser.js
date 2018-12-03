const bl = require('bl')
const { EventEmitter } = require('events')
const Packet = require('./packet')
const constants = require('./constants')

class Parser extends EventEmitter {
  constructor (opt = {}) {
    super()

    if (!(this instanceof Parser)) {
      return new Parser(opt)
    }

    this.settings = opt

    this._states = [
      '_parseHeader',
      '_parseLength',
      '_parsePayload',
      '_newPacket'
    ]

    this._resetState()
  }

  _resetState () {
    this.packet = new Packet()
    this.error = null
    this._list = bl()
    this._stateCounter = 0
  }

  parse (buf) {
    if (this.error) this._resetState()

    this._list.append(buf)

    while ((this.packet.length !== -1 || this._list.length > 0) && this[this._states[this._stateCounter]]() && !this.error) {
      this._stateCounter++
      if (this._stateCounter >= this._states.length) {
        this._stateCounter = 0
      }
    }

    return this._list.length
  }

  _parseHeader () {
    // There is at least one byte in the buffer
    const zero = this._list.readUInt8(0)
    this.packet.cmd = constants.types[zero >> constants.CMD_SHIFT]
    this.packet.retain = (zero & constants.RETAIN_MASK) !== 0
    this.packet.qos = (zero >> constants.QOS_SHIFT) & constants.QOS_MASK
    this.packet.dup = (zero & constants.DUP_MASK) !== 0

    this._list.consume(1)

    return true
  }

  _parseLength () {
    // There is at least one byte in the list
    const result = this._parseVarByteNum(true)

    if (result) {
      this.packet.length = result.value
      this._list.consume(result.bytes)
    }

    return !!result
  }

  _parsePayload () {
    let result = false

    // Do we have a payload? Do we have enough data to complete the payload?
    // PINGs have no payload
    if (this.packet.length === 0 || this._list.length >= this.packet.length) {
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

    return result
  }

  _parseConnect () {
    let protocolId // Protocol ID
    let clientId // Client ID
    let topic // Will topic
    let payload // Will payload
    let password // Password
    let username // Username
    const flags = {}
    const packet = this.packet

    // Parse protocolId
    protocolId = this._parseString()

    if (protocolId === null) {
      return this._emitError(new Error('Cannot parse protocolId'))
    }

    if (protocolId !== 'MQTT' && protocolId !== 'MQIsdp') {
      return this._emitError(new Error('Invalid protocolId'))
    }

    packet.protocolId = protocolId

    // Parse constants version number
    if (this._pos >= this._list.length) return this._emitError(new Error('Packet too short'))

    packet.protocolVersion = this._list.readUInt8(this._pos)

    if (packet.protocolVersion !== 3 && packet.protocolVersion !== 4 && packet.protocolVersion !== 5) {
      return this._emitError(new Error('Invalid protocol version'))
    }

    this._pos++

    if (this._pos >= this._list.length) {
      return this._emitError(new Error('Packet too short'))
    }

    // Parse connect flags
    flags.username = (this._list.readUInt8(this._pos) & constants.USERNAME_MASK)
    flags.password = (this._list.readUInt8(this._pos) & constants.PASSWORD_MASK)
    flags.will = (this._list.readUInt8(this._pos) & constants.WILL_FLAG_MASK)

    if (flags.will) {
      packet.will = {}
      packet.will.retain = (this._list.readUInt8(this._pos) & constants.WILL_RETAIN_MASK) !== 0
      packet.will.qos = (this._list.readUInt8(this._pos) & constants.WILL_QOS_MASK) >> constants.WILL_QOS_SHIFT
    }

    packet.clean = (this._list.readUInt8(this._pos) & constants.CLEAN_SESSION_MASK) !== 0
    this._pos++

    // Parse keepalive
    packet.keepalive = this._parseNum()
    if (packet.keepalive === -1) return this._emitError(new Error('Packet too short'))

    // parse properties
    if (packet.protocolVersion === 5) {
      const properties = this._parseProperties()
      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
    }
    // Parse clientId
    clientId = this._parseString()
    if (clientId === null) return this._emitError(new Error('Packet too short'))
    packet.clientId = clientId

    if (flags.will) {
      if (packet.protocolVersion === 5) {
        const willProperties = this._parseProperties()
        if (Object.getOwnPropertyNames(willProperties).length) {
          packet.will.properties = willProperties
        }
      }
      // Parse will topic
      topic = this._parseString()
      if (topic === null) {
        return this._emitError(new Error('Cannot parse will topic'))
      }
      packet.will.topic = topic

      // Parse will payload
      payload = this._parseBuffer()
      if (payload === null) {
        return this._emitError(new Error('Cannot parse will payload'))
      }
      packet.will.payload = payload
    }

    // Parse username
    if (flags.username) {
      username = this._parseString()
      if (username === null) {
        return this._emitError(new Error('Cannot parse username'))
      }
      packet.username = username
    }

    // Parse password
    if (flags.password) {
      password = this._parseBuffer()
      if (password === null) {
        return this._emitError(new Error('Cannot parse password'))
      }
      packet.password = password
    }
    // need for right parse auth packet and self set up
    this.settings = packet

    return packet
  }

  _parseConnack () {
    const packet = this.packet

    if (this._list.length < 2) {
      return null
    }

    packet.sessionPresent = !!(this._list.readUInt8(this._pos++) & constants.SESSIONPRESENT_MASK)

    if (this.settings.protocolVersion === 5) {
      packet.reasonCode = this._list.readUInt8(this._pos++)
    } else {
      packet.returnCode = this._list.readUInt8(this._pos++)
    }

    if (packet.returnCode === -1 || packet.reasonCode === -1) {
      return this._emitError(new Error('Cannot parse return code'))
    }

    // mqtt 5 properties
    if (this.settings.protocolVersion === 5) {
      const properties = this._parseProperties()

      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
    }
  }

  _parsePublish () {
    const packet = this.packet
    packet.topic = this._parseString()

    if (packet.topic === null) {
      return this._emitError(new Error('Cannot parse topic'))
    }

    // Parse messageId
    if (packet.qos > 0) if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      const properties = this._parseProperties()
      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
    }

    packet.payload = this._list.slice(this._pos, packet.length)
  }

  _parseSubscribe () {
    const packet = this.packet
    let topic
    let options
    let qos
    let rh
    let rap
    let nl
    let subscription

    if (packet.qos !== 1) {
      return this._emitError(new Error('Wrong subscribe header'))
    }

    packet.subscriptions = []

    if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      const properties = this._parseProperties()
      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
    }

    while (this._pos < packet.length) {
      // Parse topic
      topic = this._parseString()
      if (topic === null) return this._emitError(new Error('Cannot parse topic'))

      options = this._parseByte()
      qos = options & constants.SUBSCRIBE_OPTIONS_QOS_MASK
      nl = ((options >> constants.SUBSCRIBE_OPTIONS_NL_SHIFT) & constants.SUBSCRIBE_OPTIONS_NL_MASK) !== 0
      rap = ((options >> constants.SUBSCRIBE_OPTIONS_RAP_SHIFT) & constants.SUBSCRIBE_OPTIONS_RAP_MASK) !== 0
      rh = (options >> constants.SUBSCRIBE_OPTIONS_RH_SHIFT) & constants.SUBSCRIBE_OPTIONS_RH_MASK

      subscription = { topic, qos }

      // mqtt 5 options
      if (this.settings.protocolVersion === 5) {
        subscription.nl = nl
        subscription.rap = rap
        subscription.rh = rh
      }

      // Push pair to subscriptions
      packet.subscriptions.push(subscription)
    }
  }

  _parseSuback () {
    const packet = this.packet
    this.packet.granted = []

    if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      const properties = this._parseProperties()
      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
    }

    // Parse granted QoSes
    while (this._pos < this.packet.length) {
      this.packet.granted.push(this._list.readUInt8(this._pos++))
    }
  }

  _parseUnsubscribe () {
    const packet = this.packet

    packet.unsubscriptions = []

    // Parse messageId
    if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      const properties = this._parseProperties()
      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
    }

    while (this._pos < packet.length) {
      let topic

      // Parse topic
      topic = this._parseString()
      if (topic === null) return this._emitError(new Error('Cannot parse topic'))

      // Push topic to unsubscriptions
      packet.unsubscriptions.push(topic)
    }
  }

  _parseUnsuback () {
    const packet = this.packet
    if (!this._parseMessageId()) return this._emitError(new Error('Cannot parse messageId'))
    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      const properties = this._parseProperties()
      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
      // Parse granted QoSes
      packet.granted = []
      while (this._pos < this.packet.length) {
        this.packet.granted.push(this._list.readUInt8(this._pos++))
      }
    }
  }

  // parse packets like puback, pubrec, pubrel, pubcomp
  _parseConfirmation () {
    const packet = this.packet

    this._parseMessageId()

    if (this.settings.protocolVersion === 5) {
      if (packet.length > 2) {
        // response code
        packet.reasonCode = this._parseByte()
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
  _parseDisconnect () {
    const packet = this.packet

    if (this.settings.protocolVersion === 5) {
      // response code
      packet.reasonCode = this._parseByte()
      // properies mqtt 5
      const properties = this._parseProperties()
      if (Object.getOwnPropertyNames(properties).length) {
        packet.properties = properties
      }
    }

    return true
  }

  // parse auth packet
  _parseAuth () {
    const packet = this.packet

    if (this.settings.protocolVersion !== 5) {
      return this._emitError(new Error('Not supported auth packet for this version MQTT'))
    }

    // response code
    packet.reasonCode = this._parseByte()
    // properies mqtt 5
    const properties = this._parseProperties()
    if (Object.getOwnPropertyNames(properties).length) {
      packet.properties = properties
    }

    return true
  }

  _parseMessageId () {
    const packet = this.packet

    packet.messageId = this._parseNum()

    if (packet.messageId === null) {
      this._emitError(new Error('Cannot parse messageId'))
      return false
    }

    return true
  }

  _parseString (maybeBuffer) {
    const length = this._parseNum()
    let result
    const end = length + this._pos

    if (length === -1 || end > this._list.length || end > this.packet.length) return null

    result = this._list.toString('utf8', this._pos, end)
    this._pos += length

    return result
  }

  _parseStringPair () {
    return {
      name: this._parseString(),
      value: this._parseString()
    }
  }

  _parseBuffer () {
    const length = this._parseNum()
    let result
    const end = length + this._pos

    if (length === -1 || end > this._list.length || end > this.packet.length) return null

    result = this._list.slice(this._pos, end)

    this._pos += length

    return result
  }

  _parseNum () {
    if (this._list.length - this._pos < 2) return -1

    const result = this._list.readUInt16BE(this._pos)
    this._pos += 2

    return result
  }

  _parse4ByteNum () {
    if (this._list.length - this._pos < 4) return -1

    const result = this._list.readUInt32BE(this._pos)
    this._pos += 4

    return result
  }

  _parseVarByteNum (fullInfoFlag) {
    let bytes = 0
    let mul = 1
    let length = 0
    let result = true
    let current
    const padding = this._pos ? this._pos : 0

    while (bytes < 5) {
      current = this._list.readUInt8(padding + bytes++)
      length += mul * (current & constants.LENGTH_MASK)
      mul *= 0x80

      if ((current & constants.LENGTH_FIN_MASK) === 0) break
      if (this._list.length <= bytes) {
        result = false
        break
      }
    }

    if (padding) {
      this._pos += bytes
    }

    result = result
      ? fullInfoFlag ? {
        bytes,
        value: length
      } : length
      : false

    return result
  }

  _parseByte () {
    const result = this._list.readUInt8(this._pos)
    this._pos++
    return result
  }

  _parseByType (type) {
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

  _parseProperties () {
    const length = this._parseVarByteNum()
    const start = this._pos
    const end = start + length
    const result = {}

    while (this._pos < end) {
      const type = this._parseByte()
      const name = constants.propertiesCodes[type]
      if (!name) {
        this._emitError(new Error('Unknown property'))
        return false
      }
      // user properties process
      if (name === 'userProperties') {
        if (!result[name]) {
          result[name] = {}
        }
        const currentUserProperty = this._parseByType(constants.propertiesTypes[name])
        result[name][currentUserProperty.name] = currentUserProperty.value
        continue
      }
      result[name] = this._parseByType(constants.propertiesTypes[name])
    }
    return result
  }

  _newPacket () {
    if (this.packet) {
      this._list.consume(this.packet.length)
      this.emit('packet', this.packet)
    }

    this.packet = new Packet()

    this._pos = 0

    return true
  }

  _emitError (err) {
    this.error = err
    this.emit('error', err)
  }
}

module.exports = (...args) => new Parser(...args)
