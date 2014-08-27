
var bl        = require('bl')
  , inherits  = require('inherits')
  , EE        = require('events').EventEmitter
  , commands  = {}
  , constants = require('./constants')

function Parser(opts) {
  if (!(this instanceof Parser)) {
    return new Parser(opts)
  }

  opts = opts || {}

  this._list = bl()
  this._newPacket()
  this.encoding = opts.encoding || "utf8"

  this._states = [
      '_parseHeader'
    , '_parseLength'
    , '_parsePayload'
    , '_newPacket'
  ]
  this._stateCounter = this._states.length
}

inherits(Parser, EE)

Parser.prototype._nextState = function () {
  this._stateCounter++
  if (this._stateCounter >= this._states.length) {
    this._stateCounter = 0
  }

  return this._states[this._stateCounter]
}

Parser.prototype._newPacket = function () {
  if (this.packet) {
    this._list.consume(this.packet.length)
    this.emit('packet', this.packet)
  }

  this.packet = {}

  return true
}

Parser.prototype.parse = function (buf) {
  this._list.append(buf)

  while (this._list.length > 0 && this[this._nextState()]()) {}

  return this._list.length
}

Parser.prototype._parseHeader = function () {

  // there is at least one byte in the buffer
  var zero = this._list.readUInt8(0)
  this.packet.cmd = constants.types[zero >> constants.CMD_SHIFT]
  this.packet.retain = (zero & constants.RETAIN_MASK) !== 0
  this.packet.qos = (zero >> constants.QOS_SHIFT) & constants.QOS_MASK
  this.packet.dup = (zero & constants.DUP_MASK) !== 0

  this._list.consume(1)

  return true
}


Parser.prototype._parseLength = function () {
  // there is at least one byte in the list
  var bytes    = 0
    , mul      = 1
    , length   = 0
    , result   = true
    , current

  while (bytes < 5) {
    current = this._list.readUInt8(bytes++)
    length += mul * (current & constants.LENGTH_MASK)
    mul *= 0x80

    if ((current & constants.LENGTH_FIN_MASK) === 0) {
      break
    }

    if (this._list.length <= bytes) {
      result = false
      break
    }
  }

  if (result) {
    this.packet.length = length
    this._list.consume(bytes)
  }

  return result
}

var cmdMap = {
  'connect': '_parseConnect'
}

Parser.prototype._parsePayload = function () {
  var result = false

  // Do we have a payload? Do we have enough data to complete the payload?
  // PINGs have no payload
  if (this.packet.length === 0 || this._list.length >= this.packet.length) {
    // TODO remove try-catch
    this[cmdMap[this.packet.cmd]]()
    result = true
  }

  return result
}

Parser.prototype._parseConnect = function () {
  var protocolId // constants id
    , clientId // Client id
    , topic // Will topic
    , payload // Will payload
    , password // Password
    , username // Username
    , flags = {}
    , packet = this.packet

  this._pos = 0

  // Parse constants id
  protocolId = this._parseString()
  if (protocolId === null)
    return this.emit('error', new Error('cannot parse constants id'))

  packet.protocolId = protocolId

  // Parse constants version number
  if(this._pos > this._list.length)
    return this.emit('error', new Error('packet too short'))

  packet.protocolVersion = this._list.readUInt8(this._pos)
  this._pos++

  // Parse connect flags
  flags.username  = (this._list.readUInt8(this._pos) & constants.USERNAME_MASK)
  flags.password  = (this._list.readUInt8(this._pos) & constants.PASSWORD_MASK)
  flags.will      = (this._list.readUInt8(this._pos) & constants.WILL_FLAG_MASK)

  if (flags.will) {
    packet.will         = {}
    packet.will.retain  = (this._list.readUInt8(this._pos) & constants.WILL_RETAIN_MASK) !== 0
    packet.will.qos     = (this._list.readUInt8(this._pos) &
                          constants.WILL_QOS_MASK) >> constants.WILL_QOS_SHIFT
  }

  packet.clean = (this._list.readUInt8(this._pos) & constants.CLEAN_SESSION_MASK) !== 0
  this._pos++

  // Parse keepalive
  packet.keepalive = this._parseNum()
  if(packet.keepalive === -1)
    return this.emit('error', new Error('packet too short'))

  // Parse client ID
  clientId = this._parseString()
  if(clientId === null)
    return this.emit('error', new Error('packet too short'))
  packet.clientId = clientId

  if(flags.will) {
    // Parse will topic
    topic = this._parseString()
    if(topic === null)
      return this.emit('error', new Error('cannot parse will topic'))
    packet.will.topic = topic

    // Parse will payload
    payload = this._parseString()
    if(payload === null)
      return this.emit('error', new Error('cannot parse will payload'))
    packet.will.payload = payload
  }

  // Parse username
  if(flags.username) {
    username = this._parseString()
    if(username === null)
      return this.emit('error', new Error('cannot parse username'))
    packet.username = username
  }

  // Parse password
  if(flags.password) {
    password = this._parseString()
    if(password === null)
      return this.emit('error', new Error('cannot parse username'))
    packet.password = password
  }

  return packet
}

Parser.prototype._parseString = function () {
  var length = this._parseNum()
    , result

  if(length === -1 || length + this._pos > this._list.length)
    return null

  if (this.encoding !== 'binary') {
    result = this._list.toString(this.encoding || 'utf8', this._pos, this._pos + length)
  } else {
    result = this._list.slice(this._pos, this._pos + length)
  }

  this._pos += length

  return result
}

Parser.prototype._parseNum = function() {
  if(2 > this._pos + this._len) return -1

  var result = this._list.readUInt16BE(this._pos)
  this._pos += 2
  return result
}

module.exports.parser = Parser
