
'use strict';

var protocol = require('./constants')
  , empty = new Buffer(0)
  , zeroBuf = new Buffer([0])
  , numCache = require('./numbers')
  , nextTick = require('process-nextick-args')

function generate(packet, stream) {
  if (stream.cork) {
    stream.cork()
    nextTick(uncork, stream)
  }

  switch (packet.cmd) {
    case 'connect':
      return connect(packet, stream);
    case 'connack':
      return connack(packet, stream);
    case 'publish':
      return publish(packet, stream);
    case 'puback':
    case 'pubrec':
    case 'pubrel':
    case 'pubcomp':
    case 'unsuback':
      return confirmation(packet, stream);
    case 'subscribe':
      return subscribe(packet, stream);
    case 'suback':
      return suback(packet, stream);
    case 'unsubscribe':
      return unsubscribe(packet, stream);
    case 'pingreq':
    case 'pingresp':
    case 'disconnect':
      return emptyPacket(packet, stream);
    default:
      stream.emit('error', new Error('unknown command'));
      return false;
  }
}

function uncork(stream) {
  stream.uncork();
}

function connect(opts, stream) {
  var opts = opts || {}
    , protocolId = opts.protocolId || 'MQTT'
    , protocolVersion = opts.protocolVersion || 4
    , will = opts.will
    , clean = opts.clean
    , keepalive = opts.keepalive || 0
    , clientId = opts.clientId || ""
    , username = opts.username
    , password = opts.password

  if (clean === undefined) {
    clean = true
  }

  var length = 0

  // Must be a string and non-falsy
  if (!protocolId ||
     (typeof protocolId !== "string" && !Buffer.isBuffer(protocolId))) {
    stream.emit('error', new Error('Invalid protocol id'))
    return false
  } else {
    length += protocolId.length + 2
  }

  // Must be 3 or 4
  if (protocolVersion !== 3 && protocolVersion !== 4) {
    stream.emit('error', new Error('Invalid protocol version'))
    return false
  } else {
    length += 1
  }

  // ClientId might be omitted in 3.1.1, but only if cleanSession is set to 1
  if ((typeof clientId === "string" || Buffer.isBuffer(clientId)) &&
     (clientId || protocolVersion == 4) &&
     (clientId || clean)) {

    length += clientId.length + 2
  } else {

    if (protocolVersion < 4) {
      stream.emit('error', new Error('clientId must be supplied before 3.1.1'))
      return false
    }

    if (clean == 0) {
      stream.emit('error', new Error('clientId must be given if cleanSession set to 0'))
      return false
    }
  }

  // Must be a two byte number
  if ('number' !== typeof keepalive ||
      keepalive < 0 ||
      keepalive > 65535 ||
      keepalive % 1 !== 0) {
    stream.emit('error', new Error('Invalid keepalive'))
    return false
  } else {
    length += 2
  }

  // Connect flags
  length += 1

  // If will exists...
  if (will) {
    // It must be an object
    if ('object' !== typeof will) {
      stream.emit('error', new Error('Invalid will'))
      return false
    }
    // It must have topic typeof string
    if (!will.topic || 'string' !== typeof will.topic) {
      stream.emit('error', new Error('Invalid will topic'))
      return false
    } else {
      length += Buffer.byteLength(will.topic) + 2
    }

    // Payload
    if (will.payload && will.payload) {
      if (will.payload.length >= 0) {
        if ('string' === typeof will.payload) {
          length += Buffer.byteLength(will.payload) + 2
        } else {
          length += will.payload.length + 2
        }
      } else {
        stream.emit('error', new Error('Invalid will payload'))
        return false
      }
    } else {
      length += 2
    }
  }

  // Username
  if (username) {
    if (username.length) {
      length += Buffer.byteLength(username) + 2
    } else {
      stream.emit('error', new Error('Invalid username'))
      return false
    }
  }

  // Password
  if (password) {
    if (password.length) {
      length += byteLength(password) + 2
    } else {
      stream.emit('error', new Error('Invalid password'))
      return false
    }
  }

  // Generate header
  stream.write(protocol.CONNECT_HEADER);

  // Generate length
  writeLength(stream, length)

  // Generate protocol ID
  writeStringOrBuffer(stream, protocolId)
  stream.write(
    protocolVersion === 4 ?
      protocol.VERSION4 : protocol.VERSION3
  );

  // Connect flags
  var flags = 0
  flags |= username ? protocol.USERNAME_MASK : 0
  flags |= password ? protocol.PASSWORD_MASK : 0
  flags |= (will && will.retain) ? protocol.WILL_RETAIN_MASK : 0
  flags |= (will && will.qos) ?
    will.qos << protocol.WILL_QOS_SHIFT : 0
  flags |= will ? protocol.WILL_FLAG_MASK : 0
  flags |= clean ? protocol.CLEAN_SESSION_MASK : 0

  stream.write(new Buffer([flags]));

  // Keepalive
  writeNumber(stream, keepalive);

  // Client ID
  writeStringOrBuffer(stream, clientId);

  // Will
  if (will) {
  	writeString(stream, will.topic);
    writeStringOrBuffer(stream, will.payload);
  }

  // Username and password
  if (username)
    writeStringOrBuffer(stream, username);

  if (password)
    writeStringOrBuffer(stream, password);

  // this is a small packet that
  // happens only once on a stream
  // we assume the stream is always free
  // to receive more data after this
  return true
}

function connack(opts, stream) {
  var opts = opts || {}
    , rc = opts.returnCode;

  // Check return code
  if ('number' !== typeof rc) {
    stream.emit('error', new Error('Invalid return code'))
    return false
  }

  stream.write(protocol.CONNACK_HEADER);
  writeLength(stream, 2);
  stream.write(opts.sessionPresent ?
               protocol.SESSIONPRESENT_HEADER : zeroBuf);

  return stream.write(new Buffer([rc]));
}

function publish(opts, stream) {
  var opts = opts || {}
    , qos = opts.qos || 0
    , retain = opts.retain ? protocol.RETAIN_MASK : 0
    , topic = opts.topic
    , payload = opts.payload || empty
    , id = opts.messageId;

  var length = 0;

  // Topic must be a non-empty string or Buffer
  if (typeof topic === "string")
    length += Buffer.byteLength(topic) + 2;
  else if (Buffer.isBuffer(topic))
    length += topic.length + 2;
  else {
    stream.emit('error', new Error('Invalid topic'));
    return false;
  }

  // get the payload length
  if (!Buffer.isBuffer(payload)) {
    length += Buffer.byteLength(payload);
  } else {
    length += payload.length;
  }

  // Message id must a number if qos > 0
  if (qos && 'number' !== typeof id) {
    stream.emit('error', new Error('Invalid message id'))
    return false
  } else if (qos) {
    length += 2;
  }

  // Header
  stream.write(protocol.PUBLISH_HEADER[qos][opts.dup ? 1 : 0][retain ? 1 : 0]);

  // Remaining length
  writeLength(stream, length);

  // Topic
  writeNumber(stream, byteLength(topic));
  stream.write(topic);

  // Message ID
  if (qos > 0) {
    writeNumber(stream, id);
  }

  // Payload
  return stream.write(payload)
}

/* Puback, pubrec, pubrel and pubcomp */
function confirmation(opts, stream) {
  var opts = opts || {}
    , type = opts.cmd || 'puback'
    , id = opts.messageId
    , dup = (opts.dup && type === 'pubrel') ? protocol.DUP_MASK : 0
    , qos = 0

  if (type === 'pubrel')
    qos = 1

  // Check message ID
  if ('number' !== typeof id) {
    stream.emit('error', new Error('Invalid message id'));
    return false
  }

  // Header
  stream.write(protocol.ACKS[type][qos][dup][0])

  // Length
  writeLength(stream, 2);

  // Message ID
  return writeNumber(stream, id);
}

function subscribe(opts, stream) {
  var opts = opts || {}
    , dup = opts.dup ? protocol.DUP_MASK : 0
    , qos = opts.qos || 0
    , id = opts.messageId
    , subs = opts.subscriptions;

  var length = 0;

  // Check mid
  if ('number' !== typeof id) {
    stream.emit('error', new Error('Invalid message id'));
    return false
  } else {
    length += 2;
  }
  // Check subscriptions
  if ('object' === typeof subs && subs.length) {
    for (var i = 0; i < subs.length; i += 1) {
      var topic = subs[i].topic
        , qos = subs[i].qos;

      if ('string' !== typeof topic) {
        stream.emit('error', new Error('Invalid subscriptions - invalid topic'));
        return false
      }
      if ('number' !== typeof qos) {
        stream.emit('error', new Error('Invalid subscriptions - invalid qos'));
        return false;
      }

      length += Buffer.byteLength(topic) + 2 + 1;
    }
  } else {
    stream.emit('error', new Error('Invalid subscriptions'));
    return false;
  }

  // Generate header
  stream.write(protocol.SUBSCRIBE_HEADER[1][dup ? 1 : 0][0]);

  // Generate length
  writeLength(stream, length);

  // Generate message ID
  writeNumber(stream, id);

  var result = true

  // Generate subs
  for (var i = 0; i < subs.length; i++) {
    var sub = subs[i]
      , topic = sub.topic
      , qos = sub.qos;

    // Write topic string
    writeString(stream, topic);
    // Write qos
    result = stream.write(protocol.QOS[qos]);
  }

  return result;
}

function suback(opts, stream) {
  var opts = opts || {}
    , id = opts.messageId
    , granted = opts.granted;

  var length = 0;

  // Check message id
  if ('number' !== typeof id) {
    stream.emit('error', new Error('Invalid message id'));
    return false;
  } else {
    length += 2;
  }
  // Check granted qos vector
  if ('object' === typeof granted && granted.length) {
    for (var i = 0; i < granted.length; i += 1) {
      if ('number' !== typeof granted[i]) {
        stream.emit('error', new Error('Invalid qos vector'));
        return false;
      }
      length += 1;
    }
  } else {
    stream.emit('error', new Error('Invalid qos vector'));
    return false;
  }

  // header
  stream.write(protocol.SUBACK_HEADER);

  // Length
  writeLength(stream, length);

  // Message ID
  writeNumber(stream, id);

  return stream.write(new Buffer(granted));
}

function unsubscribe(opts, stream) {
  var opts = opts || {}
    , id = opts.messageId
    , dup = opts.dup ? protocol.DUP_MASK : 0
    , unsubs = opts.unsubscriptions;

  var length = 0;

  // Check message id
  if ('number' !== typeof id) {
    stream.emit('error', new Error('Invalid message id'));
    return false;
  } else {
    length += 2;
  }
  // Check unsubs
  if ('object' === typeof unsubs && unsubs.length) {
    for (var i = 0; i < unsubs.length; i += 1) {
      if ('string' !== typeof unsubs[i]) {
        stream.emit('error', new Error('Invalid unsubscriptions'));
        return false;
      }
      length += Buffer.byteLength(unsubs[i]) + 2;
    }
  } else {
    stream.emit('error', new Error('Invalid unsubscriptions'));
    return false;
  }

  // Header
  stream.write(protocol.UNSUBSCRIBE_HEADER[1][dup ? 1 : 0][0]);

  // Length
  writeLength(stream, length);

  // Message ID
  writeNumber(stream, id);

  // Unsubs
  var result = true
  for (var i = 0; i < unsubs.length; i++) {
    result = writeString(stream, unsubs[i]);
  }

  return result;
}

function emptyPacket(opts, stream) {
  return stream.write(protocol.EMPTY[opts.cmd]);
}

/**
 * calcLengthLength - calculate the length of the remaining
 * length field
 *
 * @api private
 */
function calcLengthLength(length) {
  if (length >= 0 && length < 128) {
    return 1
  } else if (length >= 128 && length < 16384) {
    return 2
  } else if (length >= 16384 && length < 2097152) {
    return 3
  } else if (length >= 2097152 && length < 268435456) {
    return 4
  } else {
    return 0
  }
}

function genBufLength(length) {
  var digit = 0
    , pos = 0
    , buffer = new Buffer(calcLengthLength(length))

  do {
    digit = length % 128 | 0
    length = length / 128 | 0
    if (length > 0) {
        digit = digit | 0x80
    }
    buffer.writeUInt8(digit, pos++, true)
  } while (length > 0)

  return buffer
}

/**
 * writeLength - write an MQTT style length field to the buffer
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <Number> length - length (>0)
 * @returns <Number> number of bytes written
 *
 * @api private
 */

var lengthCache = {}
function writeLength(stream, length) {
  var buffer = lengthCache[length]

  if (!buffer) {
    buffer = genBufLength(length)
    if (length < 16384) {
      lengthCache[length] = buffer
    }
  }

  stream.write(buffer)
}

/**
 * writeString - write a utf8 string to the buffer
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <String> string - string to write
 * @return <Number> number of bytes written
 *
 * @api private
 */

function writeString(stream, string) {
  var strlen = Buffer.byteLength(string)
  writeNumber(stream, strlen)

  stream.write(string, 'utf8')
}

function writeStringNoPos(buffer, pos, string) {
  buffer.write(string, pos)
}

/**
 * write_buffer - write buffer to buffer
 *
 * @param <Buffer> buffer - dest buffer
 * @param <Number> pos - offset
 * @param <Buffer> src - source buffer
 * @return <Number> number of bytes written
 *
 * @api private
 */

function writeBuffer(buffer, pos, src) {
  src.copy(buffer, pos)
  return src.length
}

/**
 * writeNumber - write a two byte number to the buffer
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <String> number - number to write
 * @return <Number> number of bytes written
 *
 * @api private
 */
function writeNumber(stream, number) {
  return stream.write(numCache[number])
}

/**
 * writeStringOrBuffer - write a String or Buffer with the its length prefix
 *
 * @param <Buffer> buffer - destination
 * @param <Number> pos - offset
 * @param <String> toWrite - String or Buffer
 * @return <Number> number of bytes written
 */
function writeStringOrBuffer(stream, toWrite) {
  if (toWrite && typeof toWrite === 'string') {
    writeString(stream, toWrite)
  } else if (toWrite) {
    writeNumber(stream, toWrite.length)
    stream.write(toWrite)
  } else {
    writeNumber(stream, 0)
  }
}

function byteLength(bufOrString) {
  if (!bufOrString) {
    return 0
  } else if (Buffer.isBuffer(bufOrString)) {
    return bufOrString.length
  } else {
    return Buffer.byteLength(bufOrString)
  }
}

module.exports = generate
