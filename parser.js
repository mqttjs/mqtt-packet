const bl = require('bl')
const { EventEmitter } = require('events')
const Packet = require('./packet')
const constants = require('./constants')
const debug = require('debug')('mqtt-packet:parser')

class Parser extends EventEmitter {
  constructor () {
    super()
    this.parser = this.constructor.parser
  }

  static parser (opt) {
    if (!(this instanceof Parser)) return (new Parser()).parser(opt)

    this.settings = opt || {}

    this._states = [
      '_parseHeader',
      '_parseLength',
      '_parsePayload',
      '_newPacket'
    ]

    this._resetState()
    return this
  }

  _resetState () {
    debug('_resetState: dropping %d buffered bytes after %s', this._list ? this._list.length : 0, this.error ? this.error.message : 'no error')
    this.packet = new Packet()
    this.error = null
    this._list = bl()
    // Reset _pos too: a mid-packet error leaves it non-zero, and the next
    // packet's reads would start from the stale offset.
    this._pos = 0
    this._truncated = false
    this._blockEnd = -1
    this._stateCounter = 0
  }

  parse (buf) {
    if (this.error) this._resetState()

    this._list.append(buf)
    debug('parse: current state: %s', this._states[this._stateCounter])
    while ((this.packet.length !== -1 || this._list.length > 0) &&
      this[this._states[this._stateCounter]]() &&
      !this.error) {
      this._stateCounter++
      debug('parse: state complete. _stateCounter is now: %d', this._stateCounter)
      debug('parse: packet.length: %d, buffer list length: %d', this.packet.length, this._list.length)
      if (this._stateCounter >= this._states.length) this._stateCounter = 0
    }
    debug('parse: exited while loop. packet: %d, buffer list length: %d', this.packet.length, this._list.length)
    return this._list.length
  }

  _parseHeader () {
    // There is at least one byte in the buffer
    const zero = this._list.readUInt8(0)
    const cmdIndex = zero >> constants.CMD_SHIFT
    this.packet.cmd = constants.types[cmdIndex]
    const headerFlags = zero & 0xf
    const requiredHeaderFlags = constants.requiredHeaderFlags[cmdIndex]
    if (requiredHeaderFlags != null && headerFlags !== requiredHeaderFlags) {
      // Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
      return this._emitError(new Error(constants.requiredHeaderFlagsErrors[cmdIndex]))
    }
    this.packet.retain = (zero & constants.RETAIN_MASK) !== 0
    this.packet.qos = (zero >> constants.QOS_SHIFT) & constants.QOS_MASK
    if (this.packet.qos > 2) {
      return this._emitError(new Error('Packet must not have both QoS bits set to 1'))
    }
    this.packet.dup = (zero & constants.DUP_MASK) !== 0
    debug('_parseHeader: packet: %o', this.packet)

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
    debug('_parseLength %d', result.value)
    return !!result
  }

  _parsePayload () {
    debug('_parsePayload: %d buffered bytes, packet length %d', this._list.length, this.packet.length)
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
    debug('_parsePayload complete result: %s', result)
    return result
  }

  _parseConnect () {
    debug('_parseConnect')
    let topic // Will topic
    let payload // Will payload
    let password // Password
    let username // Username
    const flags = {}
    const packet = this.packet

    // Parse protocolId
    const protocolId = this._parseString()

    if (protocolId === null) return this._emitError(new Error('Cannot parse protocolId'))
    if (protocolId !== 'MQTT' && protocolId !== 'MQIsdp') {
      return this._emitError(new Error('Invalid protocolId'))
    }

    packet.protocolId = protocolId

    // Parse constants version number
    if (this._overruns(1)) return this._emitError(new Error('Packet too short'))

    packet.protocolVersion = this._list.readUInt8(this._pos)

    if (packet.protocolVersion >= 128) {
      packet.bridgeMode = true
      packet.protocolVersion = packet.protocolVersion - 128
    }

    if (packet.protocolVersion !== 3 && packet.protocolVersion !== 4 && packet.protocolVersion !== 5) {
      return this._emitError(new Error('Invalid protocol version'))
    }

    this._pos++

    if (this._overruns(1)) {
      return this._emitError(new Error('Packet too short'))
    }

    if (this._list.readUInt8(this._pos) & 0x1) {
      // The Server MUST validate that the reserved flag in the CONNECT Control Packet is set to zero and disconnect the Client if it is not zero [MQTT-3.1.2-3]
      return this._emitError(new Error('Connect flag bit 0 must be 0, but got 1'))
    }
    // Parse connect flags
    flags.username = (this._list.readUInt8(this._pos) & constants.USERNAME_MASK)
    flags.password = (this._list.readUInt8(this._pos) & constants.PASSWORD_MASK)
    flags.will = (this._list.readUInt8(this._pos) & constants.WILL_FLAG_MASK)

    const willRetain = !!(this._list.readUInt8(this._pos) & constants.WILL_RETAIN_MASK)
    const willQos = (this._list.readUInt8(this._pos) &
        constants.WILL_QOS_MASK) >> constants.WILL_QOS_SHIFT

    if (flags.will) {
      packet.will = {}
      packet.will.retain = willRetain
      packet.will.qos = willQos
    } else {
      if (willRetain) {
        return this._emitError(new Error('Will Retain Flag must be set to zero when Will Flag is set to 0'))
      }
      if (willQos) {
        return this._emitError(new Error('Will QoS must be set to zero when Will Flag is set to 0'))
      }
    }

    packet.clean = (this._list.readUInt8(this._pos) & constants.CLEAN_SESSION_MASK) !== 0
    this._pos++

    // Parse keepalive
    packet.keepalive = this._parseNum()
    if (packet.keepalive === -1) return this._emitError(new Error('Packet too short'))

    // parse properties
    if (packet.protocolVersion === 5) {
      if (!this._parsePropertiesInto(packet)) return
    }
    // Parse clientId
    const clientId = this._parseString()
    if (clientId === null) return this._emitError(new Error('Packet too short'))
    packet.clientId = clientId
    debug('_parseConnect: packet.clientId: %s', packet.clientId)

    if (flags.will) {
      if (packet.protocolVersion === 5) {
        if (!this._parsePropertiesInto(packet.will)) return
      }
      // Parse will topic
      topic = this._parseString()
      if (topic === null) return this._emitError(new Error('Cannot parse will topic'))
      packet.will.topic = topic
      debug('_parseConnect: packet.will.topic: %s', packet.will.topic)

      // Parse will payload
      payload = this._parseBuffer()
      if (payload === null) return this._emitError(new Error('Cannot parse will payload'))
      packet.will.payload = payload
      debug('_parseConnect: packet.will.paylaod: %s', packet.will.payload)
    }

    // Parse username
    if (flags.username) {
      username = this._parseString()
      if (username === null) return this._emitError(new Error('Cannot parse username'))
      packet.username = username
      debug('_parseConnect: packet.username: %s', packet.username)
    }

    // Parse password
    if (flags.password) {
      password = this._parseBuffer()
      if (password === null) return this._emitError(new Error('Cannot parse password'))
      packet.password = password
    }
    // need for right parse auth packet and self set up
    this.settings = packet
    debug('_parseConnect: complete')
    return packet
  }

  _parseConnack () {
    debug('_parseConnack')
    const packet = this.packet

    // Ack flags plus a reason/return code are always on the wire (MQTT-5
    // §3.2.2). Gate on packet.length, not _list.length, so a pipelined packet
    // is never read as this CONNACK's bytes - and so a CONNACK carrying no code
    // byte is rejected rather than reported as Success.
    if (packet.length < 2) return this._emitError(new Error('Malformed connack, packet too short'))

    const flags = this._parseByte()
    if (flags > 1) {
      return this._emitError(new Error('Invalid connack flags, bits 7-1 must be set to 0'))
    }
    packet.sessionPresent = !!(flags & constants.SESSIONPRESENT_MASK)

    if (this.settings.protocolVersion === 5) {
      packet.reasonCode = this._parseByte()
      // MQTT-5 §3.2.2.3 makes the property length unconditional, but a v4-only
      // server refusing a v5 CONNECT answers in v4 format, which has no property
      // block - so accept the 2-byte form rather than demand the full 3.
      if (packet.length >= 3) {
        if (!this._parsePropertiesInto(packet)) return
      }
    } else {
      packet.returnCode = this._parseByte()
    }

    debug('_parseConnack: complete')
  }

  _parsePublish () {
    debug('_parsePublish')
    const packet = this.packet
    packet.topic = this._parseString()

    if (packet.topic === null) return this._emitError(new Error('Cannot parse topic'))

    // Parse messageId
    if (packet.qos > 0) if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      if (!this._parsePropertiesInto(packet)) return
    }

    packet.payload = this._list.slice(this._pos, packet.length)
    debug('_parsePublish: payload from buffer list: %o', packet.payload)
  }

  _parseSubscribe () {
    debug('_parseSubscribe')
    const packet = this.packet
    let topic
    let options
    let qos
    let rh
    let rap
    let nl
    let subscription

    packet.subscriptions = []

    if (packet.length <= 0) { return this._emitError(new Error('Malformed subscribe, no payload specified')) }

    if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      if (!this._parsePropertiesInto(packet)) return
    }

    while (!this._overruns(1)) {
      // Parse topic
      topic = this._parseString()
      if (topic === null) return this._emitError(new Error('Cannot parse topic'))
      if (this._pos >= packet.length) return this._emitError(new Error('Malformed Subscribe Payload'))

      options = this._parseByte()

      if (this.settings.protocolVersion === 5) {
        if (options & 0xc0) {
          return this._emitError(new Error('Invalid subscribe topic flag bits, bits 7-6 must be 0'))
        }
      } else {
        if (options & 0xfc) {
          return this._emitError(new Error('Invalid subscribe topic flag bits, bits 7-2 must be 0'))
        }
      }

      qos = options & constants.SUBSCRIBE_OPTIONS_QOS_MASK
      if (qos > 2) {
        return this._emitError(new Error('Invalid subscribe QoS, must be <= 2'))
      }
      nl = ((options >> constants.SUBSCRIBE_OPTIONS_NL_SHIFT) & constants.SUBSCRIBE_OPTIONS_NL_MASK) !== 0
      rap = ((options >> constants.SUBSCRIBE_OPTIONS_RAP_SHIFT) & constants.SUBSCRIBE_OPTIONS_RAP_MASK) !== 0
      rh = (options >> constants.SUBSCRIBE_OPTIONS_RH_SHIFT) & constants.SUBSCRIBE_OPTIONS_RH_MASK

      if (rh > 2) {
        return this._emitError(new Error('Invalid retain handling, must be <= 2'))
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
      debug('_parseSubscribe: push subscription `%s` to subscription', subscription)
      packet.subscriptions.push(subscription)
    }

    // At least one topic filter, every version [MQTT-3.8.3-3]. Without this a
    // packet whose payload is consumed upstream parses as an empty SUBSCRIBE.
    if (!packet.subscriptions.length) {
      return this._emitError(new Error('Malformed subscribe, no topic filters specified'))
    }
  }

  _parseSuback () {
    debug('_parseSuback')
    const packet = this.packet
    this.packet.granted = []

    if (packet.length <= 0) { return this._emitError(new Error('Malformed suback, no payload specified')) }

    if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      if (!this._parsePropertiesInto(packet)) return
    }

    // Parse granted QoSes
    while (!this._overruns(1)) {
      const code = this._parseByte()
      if (this.settings.protocolVersion === 5) {
        if (!constants.MQTT5_SUBACK_CODES[code]) {
          return this._emitError(new Error('Invalid suback code'))
        }
      } else {
        if (code > 2 && code !== 0x80) {
          return this._emitError(new Error('Invalid suback QoS, must be 0, 1, 2 or 128'))
        }
      }
      this.packet.granted.push(code)
    }

    // One reason code per subscription, in 3.1.1 as well as 5.0 (MQTT-5 §3.9.3,
    // MQTT-3.1.1 §3.9.3). An
    // empty list means something upstream - usually a property block - consumed
    // the payload, which used to be accepted silently.
    if (!packet.granted.length) {
      return this._emitError(new Error('Malformed suback, no reason codes specified'))
    }
  }

  _parseUnsubscribe () {
    debug('_parseUnsubscribe')
    const packet = this.packet

    packet.unsubscriptions = []

    if (packet.length <= 0) { return this._emitError(new Error('Malformed unsubscribe, no payload specified')) }

    // Parse messageId
    if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      if (!this._parsePropertiesInto(packet)) return
    }

    while (!this._overruns(1)) {
      // Parse topic
      const topic = this._parseString()
      if (topic === null) return this._emitError(new Error('Cannot parse topic'))

      // Push topic to unsubscriptions
      debug('_parseUnsubscribe: push topic `%s` to unsubscriptions', topic)
      packet.unsubscriptions.push(topic)
    }

    // At least one topic filter [MQTT-3.10.3-2].
    if (!packet.unsubscriptions.length) {
      return this._emitError(new Error('Malformed unsubscribe, no topic filters specified'))
    }
  }

  _parseUnsuback () {
    debug('_parseUnsuback')
    const packet = this.packet
    if ((this.settings.protocolVersion === 3 ||
      this.settings.protocolVersion === 4) && packet.length !== 2) {
      return this._emitError(new Error('Malformed unsuback, payload length must be 2'))
    }
    if (packet.length <= 0) { return this._emitError(new Error('Malformed unsuback, no payload specified')) }

    if (!this._parseMessageId()) { return }

    // Properties mqtt 5
    if (this.settings.protocolVersion === 5) {
      if (!this._parsePropertiesInto(packet)) return
      // Parse granted QoSes
      packet.granted = []

      while (!this._overruns(1)) {
        const code = this._parseByte()
        if (!constants.MQTT5_UNSUBACK_CODES[code]) {
          return this._emitError(new Error('Invalid unsuback code'))
        }
        this.packet.granted.push(code)
      }

      // One reason code per unsubscription (MQTT-5 §3.11.3).
      // Only 5.0 carries them; 3.1.1 UNSUBACK has no payload.
      if (!packet.granted.length) {
        return this._emitError(new Error('Malformed unsuback, no reason codes specified'))
      }
    }
  }

  // parse packets like puback, pubrec, pubrel, pubcomp
  _parseConfirmation () {
    debug('_parseConfirmation: packet.cmd: `%s`', this.packet.cmd)
    const packet = this.packet

    if (!this._parseMessageId()) { return }

    if (this.settings.protocolVersion === 5) {
      if (packet.length > 2) {
        // response code
        packet.reasonCode = this._parseByte()
        switch (this.packet.cmd) {
          case 'puback':
          case 'pubrec':
            if (!constants.MQTT5_PUBACK_PUBREC_CODES[packet.reasonCode]) {
              return this._emitError(new Error('Invalid ' + this.packet.cmd + ' reason code'))
            }
            break
          case 'pubrel':
          case 'pubcomp':
            if (!constants.MQTT5_PUBREL_PUBCOMP_CODES[packet.reasonCode]) {
              return this._emitError(new Error('Invalid ' + this.packet.cmd + ' reason code'))
            }
            break
        }
        debug('_parseConfirmation: packet.reasonCode `%d`', packet.reasonCode)
      } else {
        packet.reasonCode = 0
      }

      if (packet.length > 3) {
        // properies mqtt 5
        if (!this._parsePropertiesInto(packet)) return
      }
    }

    return true
  }

  // DISCONNECT and AUTH share a variable header: the reason code may be omitted
  // when it is 0 and there are no properties, and below remaining length 2 there
  // is no property length either (MQTT-5 §3.14.2.2.1, §3.15.2.2.1). Both bound by
  // packet.length, never _list.length - reading either from the running buffer
  // is the bug this whole change is about, and it was there twice.
  _parseReasonCodeAndProperties (codes) {
    const packet = this.packet

    if (packet.length > 0) {
      packet.reasonCode = this._parseByte()
      if (!codes[packet.reasonCode]) {
        this._emitError(new Error('Invalid ' + packet.cmd + ' reason code'))
        return false
      }
    } else {
      packet.reasonCode = 0
    }

    if (packet.length >= 2) {
      return this._parsePropertiesInto(packet)
    }
    return true
  }

  // parse disconnect packet
  _parseDisconnect () {
    debug('_parseDisconnect')

    if (this.settings.protocolVersion === 5) {
      if (!this._parseReasonCodeAndProperties(constants.MQTT5_DISCONNECT_CODES)) return
    }

    debug('_parseDisconnect result: true')
    return true
  }

  // parse auth packet
  _parseAuth () {
    debug('_parseAuth')

    if (this.settings.protocolVersion !== 5) {
      return this._emitError(new Error('Not supported auth packet for this version MQTT'))
    }

    if (!this._parseReasonCodeAndProperties(constants.MQTT5_AUTH_CODES)) return

    debug('_parseAuth: result: true')
    return true
  }

  _parseMessageId () {
    const packet = this.packet

    packet.messageId = this._parseNum()

    if (packet.messageId === -1) {
      this._emitError(new Error('Malformed ' + packet.cmd + ', cannot parse messageId'))
      return false
    }

    debug('_parseMessageId: packet.messageId %d', packet.messageId)
    return true
  }

  // The innermost boundary the current read must stay inside: the open property
  // block if there is one, else this packet's remaining length. -1 is the header
  // phase, where the remaining length itself is read against the whole buffer.
  _readEnd () {
    return this._blockEnd !== -1 ? this._blockEnd : this.packet.length
  }

  // True when reading `n` more bytes would cross that boundary. In the payload
  // phase the whole packet is already buffered, so crossing it is a Malformed
  // Packet (MQTT-5 §4.13) rather than "wait for more data" - _truncated records
  // it so _parseProperties can turn an otherwise silent null into an error.
  _overruns (n) {
    const end = this._pos + n
    const limit = this._readEnd()
    if (limit !== -1 && end > limit) {
      debug('_overruns: %d bytes at _pos %d cross the %s end %d', n, this._pos, this._blockEnd !== -1 ? 'property block' : 'packet', limit)
      this._truncated = true
      return true
    }
    if (end > this._list.length) {
      debug('_overruns: %d bytes at _pos %d cross the buffer end %d', n, this._pos, this._list.length)
      return true
    }
    return false
  }

  _parseString (maybeBuffer) {
    const length = this._parseNum()

    if (length === -1 || this._overruns(length)) return null

    const end = this._pos + length
    const result = this._list.toString('utf8', this._pos, end)
    this._pos += length
    debug('_parseString: result: %s', result)
    return result
  }

  _parseStringPair () {
    debug('_parseStringPair')
    return {
      name: this._parseString(),
      value: this._parseString()
    }
  }

  _parseBuffer () {
    const length = this._parseNum()

    if (length === -1 || this._overruns(length)) return null

    const result = this._list.slice(this._pos, this._pos + length)

    this._pos += length
    debug('_parseBuffer: result: %o', result)
    return result
  }

  _parseNum () {
    if (this._overruns(2)) return -1

    const result = this._list.readUInt16BE(this._pos)
    this._pos += 2
    debug('_parseNum: result: %s', result)
    return result
  }

  _parse4ByteNum () {
    if (this._overruns(4)) return -1

    const result = this._list.readUInt32BE(this._pos)
    this._pos += 4
    debug('_parse4ByteNum: result: %s', result)
    return result
  }

  _parseVarByteNum (fullInfoFlag) {
    debug('_parseVarByteNum')
    const maxBytes = 4
    let bytes = 0
    let mul = 1
    let value = 0
    let result = false
    let current
    const start = this._pos
    // _overruns carries the boundary for every reader, so the loop stops at the
    // property block, the packet or the buffer without restating any of them.
    while (bytes < maxBytes && !this._overruns(bytes + 1)) {
      current = this._list.readUInt8(start + bytes++)
      value += mul * (current & constants.VARBYTEINT_MASK)
      mul *= 0x80

      if ((current & constants.VARBYTEINT_FIN_MASK) === 0) {
        result = true
        break
      }
    }

    // In the payload phase the whole packet is buffered, so running out of
    // bytes means the varint is truncated by a boundary, not that more data is
    // on the way (MQTT-5 §4.13 Malformed Packet).
    if (!result && ((bytes === maxBytes && this._list.length >= bytes) || this.packet.length !== -1)) {
      this._emitError(new Error('Malformed ' + this.packet.cmd + ', invalid variable byte integer'))
    }

    // The header phase re-runs from _pos 0 until the whole varint has arrived,
    // so only the payload phase advances the read position.
    if (this.packet.length !== -1) {
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

    debug('_parseVarByteNum: result: %o', result)
    return result
  }

  _parseByte () {
    let result
    if (!this._overruns(1)) {
      result = this._list.readUInt8(this._pos)
      this._pos++
    }
    debug('_parseByte: result: %o', result)
    return result
  }

  _parseByType (type) {
    debug('_parseByType: type: %s', type)
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

  // Reads the property block into `target`, or returns false once the error is
  // emitted. Every caller must stop parsing on false.
  _parsePropertiesInto (target) {
    const properties = this._parseProperties()
    if (properties === false) return false
    if (Object.getOwnPropertyNames(properties).length) {
      target.properties = properties
    }
    return true
  }

  _parseProperties () {
    debug('_parseProperties')
    this._truncated = false
    const length = this._parseVarByteNum()
    // `0` is a valid length, so only `false` means the varint itself failed;
    // _parseVarByteNum has already emitted.
    if (length === false) return false
    const end = this._pos + length
    // A declared property length that runs past this packet's boundary would
    // read the following pipelined packet's bytes. Treat that as malformed.
    if (this.packet.length !== -1 && end > this.packet.length) {
      this._emitError(new Error('Malformed ' + this.packet.cmd + ', property length exceeds remaining length'))
      return false
    }
    // Inside the block every read is bounded by the declared length as well as
    // by the packet, so a value cannot spill into the packet's own body. Blocks
    // never nest - CONNECT's will and packet properties are read in sequence -
    // so the finally clears rather than restores, and it is there for the error
    // returns below.
    this._blockEnd = end
    try {
      return this._parsePropertyList()
    } finally {
      this._blockEnd = -1
    }
  }

  _parsePropertyList () {
    const end = this._blockEnd
    const result = {}
    debug('_parsePropertyList: reading properties up to _pos %d', end)
    while (this._pos < end) {
      const type = this._parseByte()
      if (!type) {
        this._emitError(new Error('Cannot parse property code type'))
        return false
      }
      const name = constants.propertiesCodes[type]
      if (!name) {
        this._emitError(new Error('Unknown property'))
        return false
      }
      debug('_parsePropertyList: property %s', name)
      const value = this._parseByType(constants.propertiesTypes[name])
      // A reader that reported its own failure has already emitted; a second
      // error for the same packet would tear the connection down twice.
      if (this.error) return false
      if (this._truncated) {
        this._emitError(new Error('Malformed ' + this.packet.cmd + ', property ' + name + ' exceeds the property length'))
        return false
      }
      // user properties process
      if (name === 'userProperties') {
        if (!result[name]) {
          result[name] = Object.create(null)
        }
        if (result[name][value.name] !== undefined) {
          if (Array.isArray(result[name][value.name])) {
            result[name][value.name].push(value.value)
          } else {
            const currentValue = result[name][value.name]
            result[name][value.name] = [currentValue]
            result[name][value.name].push(value.value)
          }
        } else {
          result[name][value.name] = value.value
        }
        continue
      }
      if (result[name]) {
        if (Array.isArray(result[name])) {
          result[name].push(value)
        } else {
          result[name] = [result[name]]
          result[name].push(value)
        }
      } else {
        result[name] = value
      }
    }
    return result
  }

  _newPacket () {
    debug('_newPacket')
    if (this.packet) {
      this._list.consume(this.packet.length)
      debug('_newPacket: parser emit packet: packet.cmd: %s, packet.payload: %s, packet.length: %d', this.packet.cmd, this.packet.payload, this.packet.length)
      this.emit('packet', this.packet)
    }
    debug('_newPacket: new packet')
    this.packet = new Packet()

    this._pos = 0
    this._truncated = false
    this._blockEnd = -1

    return true
  }

  _emitError (err) {
    // Every parse failure is a Malformed Packet (MQTT-5 §4.13). The code and cmd
    // let a consumer react without matching on the message text, and the counts
    // say how much of the stream is about to be dropped - the next parse() calls
    // _resetState, and a consumer that tears down on error never gets there.
    err.code = 'MALFORMED_PACKET'
    err.cmd = this.packet.cmd
    debug('_emitError: %s (_pos %d, %d buffered bytes discarded)', err.message, this._pos, this._list.length)
    this.error = err
    this.emit('error', err)
  }
}

module.exports = Parser
