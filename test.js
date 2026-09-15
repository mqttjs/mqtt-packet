const util = require('util')

const test = require('tape')
const mqtt = require('./')
const constants = require('./constants')
const WS = require('readable-stream').Writable

function normalExpectedObject (object) {
  if (object.username != null) object.username = object.username.toString()
  if (object.password != null) object.password = Buffer.from(object.password)
  return object
}

function testParseGenerate (name, object, buffer, opts) {
  test(`${name} parse`, t => {
    t.plan(2)

    const parser = mqtt.parser(opts)
    const expected = object
    const fixture = buffer

    parser.on('packet', packet => {
      if (packet.cmd !== 'publish') {
        delete packet.topic
        delete packet.payload
      }
      t.deepLooseEqual(packet, normalExpectedObject(expected), 'expected packet')
    })

    parser.on('error', err => {
      t.fail(err)
    })

    t.equal(parser.parse(fixture), 0, 'remaining bytes')
  })

  test(`${name} generate`, t => {
    // For really large buffers, the expanded hex string can be so long as to
    // generate an error in nodejs 14.x, so only do the test with extra output
    // for relatively small buffers.
    const bigLength = 10000
    const generatedBuffer = mqtt.generate(object, opts)
    if (generatedBuffer.length < bigLength && buffer.length < bigLength) {
      t.equal(generatedBuffer.toString('hex'), buffer.toString('hex'))
    } else {
      const bufferOkay = generatedBuffer.equals(buffer)
      if (bufferOkay) {
        t.pass()
      } else {
        // Output abbreviated representations of the buffers.
        t.comment('Expected:\n' + util.inspect(buffer))
        t.comment('Got:\n' + util.inspect(generatedBuffer))
        t.fail('Large buffers not equal')
      }
    }
    t.end()
  })

  test(`${name} mirror`, t => {
    t.plan(2)

    const parser = mqtt.parser(opts)
    const expected = object
    const fixture = mqtt.generate(object, opts)

    parser.on('packet', packet => {
      if (packet.cmd !== 'publish') {
        delete packet.topic
        delete packet.payload
      }
      t.deepLooseEqual(packet, normalExpectedObject(expected), 'expected packet')
    })

    parser.on('error', err => {
      t.fail(err)
    })

    t.equal(parser.parse(fixture), 0, 'remaining bytes')
  })

  test(`${name} writeToStream`, t => {
    const stream = WS()
    stream.write = () => true
    stream.on('error', (err) => t.fail(err))

    const result = mqtt.writeToStream(object, stream, opts)
    t.equal(result, true, 'should return true')
    t.end()
  })
}

// the API allows to pass strings as buffers to writeToStream and generate
// parsing them back will result in a string so only generate and compare to buffer
function testGenerateOnly (name, object, buffer, opts) {
  test(name, t => {
    t.equal(mqtt.generate(object, opts).toString('hex'), buffer.toString('hex'))
    t.end()
  })
}

function testParseOnly (name, object, buffer, opts) {
  test(name, t => {
    const parser = mqtt.parser(opts)
    // const expected = object
    // const fixture = buffer

    t.plan(2 + Object.keys(object).length)

    parser.on('packet', packet => {
      t.equal(Object.keys(object).length, Object.keys(packet).length, 'key count')
      Object.keys(object).forEach(key => {
        t.deepEqual(packet[key], object[key], `expected packet property ${key}`)
      })
    })

    t.equal(parser.parse(buffer), 0, 'remaining bytes')
    t.end()
  })
}

function testParseError (expected, fixture, opts) {
  test(expected, t => {
    t.plan(3)

    const parser = mqtt.parser(opts)
    const expectedCmd = constants.types[fixture[0] >> 4]

    parser.on('error', err => {
      t.equal(err.message, expected, 'expected error message')
      t.equal(err.code, 'MALFORMED_PACKET', 'expected error code')
      t.equal(err.cmd, expectedCmd, 'expected error cmd')
    })

    parser.on('packet', () => {
      t.fail('parse errors should not be followed by packet events')
    })

    parser.parse(fixture)
    t.end()
  })
}

function testGenerateError (expected, fixture, opts, name) {
  test(name || expected, t => {
    t.plan(1)

    try {
      mqtt.generate(fixture, opts)
    } catch (err) {
      t.equal(expected, err.message)
    }
    t.end()
  })
}

function testGenerateErrorMultipleCmds (cmds, expected, fixture, opts) {
  cmds.forEach(cmd => {
    const obj = Object.assign({}, fixture)
    obj.cmd = cmd
    testGenerateError(expected, obj, opts, `${expected} on ${cmd}`)
  }
  )
}

function testParseGenerateDefaults (name, object, buffer, generated, opts) {
  testParseOnly(`${name} parse`, generated, buffer, opts)
  testGenerateOnly(`${name} generate`, object, buffer, opts)
}

function testParseAndGenerate (name, object, buffer, opts) {
  testParseOnly(`${name} parse`, object, buffer, opts)
  testGenerateOnly(`${name} generate`, object, buffer, opts)
}

function testWriteToStreamError (expected, fixture) {
  test(`writeToStream ${expected} error`, t => {
    t.plan(2)

    const stream = WS()

    stream.write = () => t.fail('should not have called write')
    stream.on('error', () => t.pass('error emitted'))

    const result = mqtt.writeToStream(fixture, stream)

    t.false(result, 'result should be false')
  })
}

test('cacheNumbers get/set/unset', t => {
  t.true(mqtt.writeToStream.cacheNumbers, 'initial state of cacheNumbers is enabled')
  mqtt.writeToStream.cacheNumbers = false
  t.false(mqtt.writeToStream.cacheNumbers, 'cacheNumbers can be disabled')
  mqtt.writeToStream.cacheNumbers = true
  t.true(mqtt.writeToStream.cacheNumbers, 'cacheNumbers can be enabled')
  t.end()
})

test('disabled numbers cache', t => {
  const stream = WS()
  const message = {
    cmd: 'publish',
    retain: false,
    qos: 0,
    dup: false,
    length: 10,
    topic: Buffer.from('test'),
    payload: Buffer.from('test')
  }
  const expected = Buffer.from([
    48, 10, // Header
    0, 4, // Topic length
    116, 101, 115, 116, // Topic (test)
    116, 101, 115, 116 // Payload (test)
  ])
  let written = Buffer.alloc(0)

  stream.write = (chunk) => {
    written = Buffer.concat([written, chunk])
  }
  mqtt.writeToStream.cacheNumbers = false

  mqtt.writeToStream(message, stream)

  t.deepEqual(written, expected, 'written buffer is expected')

  mqtt.writeToStream.cacheNumbers = true

  stream.end()
  t.end()
})

testGenerateError('Unknown command', {})

testParseError('Not supported', Buffer.from([0, 1, 0]), {})

// Length header field. The packet type is already known from the fixed header,
// so the Remaining Length varint error names it like every other parse error.
testParseError('Malformed connect, invalid variable byte integer', Buffer.from(
  [16, 255, 255, 255, 255]
), {})
testParseError('Malformed connect, invalid variable byte integer', Buffer.from(
  [16, 255, 255, 255, 128]
), {})
testParseError('Malformed connect, invalid variable byte integer', Buffer.from(
  [16, 255, 255, 255, 255, 1]
), {})
testParseError('Malformed connect, invalid variable byte integer', Buffer.from(
  [16, 255, 255, 255, 255, 127]
), {})
testParseError('Malformed connect, invalid variable byte integer', Buffer.from(
  [16, 255, 255, 255, 255, 128]
), {})
testParseError('Malformed connect, invalid variable byte integer', Buffer.from(
  [16, 255, 255, 255, 255, 255, 1]
), {})

testParseGenerate('minimal connect', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 18,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: false,
  keepalive: 30,
  clientId: 'test'
}, Buffer.from([
  16, 18, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  0, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116 // Client ID
]))

testGenerateOnly('minimal connect with clientId as Buffer', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 18,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: false,
  keepalive: 30,
  clientId: Buffer.from('test')
}, Buffer.from([
  16, 18, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  0, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116 // Client ID
]))

testParseGenerate('connect MQTT bridge 131', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 18,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  bridgeMode: true,
  clean: false,
  keepalive: 30,
  clientId: 'test'
}, Buffer.from([
  16, 18, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  131, // Protocol version
  0, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116 // Client ID
]))

testParseGenerate('connect MQTT bridge 132', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 18,
  protocolId: 'MQIsdp',
  protocolVersion: 4,
  bridgeMode: true,
  clean: false,
  keepalive: 30,
  clientId: 'test'
}, Buffer.from([
  16, 18, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  132, // Protocol version
  0, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116 // Client ID
]))

testParseGenerate('connect MQTT 5', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 125,
  protocolId: 'MQTT',
  protocolVersion: 5,
  will: {
    retain: true,
    qos: 2,
    properties: {
      willDelayInterval: 1234,
      payloadFormatIndicator: false,
      messageExpiryInterval: 4321,
      contentType: 'test',
      responseTopic: 'topic',
      correlationData: Buffer.from([1, 2, 3, 4]),
      userProperties: {
        test: 'test'
      }
    },
    topic: 'topic',
    payload: Buffer.from([4, 3, 2, 1])
  },
  clean: true,
  keepalive: 30,
  properties: {
    sessionExpiryInterval: 1234,
    receiveMaximum: 432,
    maximumPacketSize: 100,
    topicAliasMaximum: 456,
    requestResponseInformation: true,
    requestProblemInformation: true,
    userProperties: {
      test: 'test'
    },
    authenticationMethod: 'test',
    authenticationData: Buffer.from([1, 2, 3, 4])
  },
  clientId: 'test'
}, Buffer.from([
  16, 125, // Header
  0, 4, // Protocol ID length
  77, 81, 84, 84, // Protocol ID
  5, // Protocol version
  54, // Connect flags
  0, 30, // Keepalive
  47, // properties length
  17, 0, 0, 4, 210, // sessionExpiryInterval
  33, 1, 176, // receiveMaximum
  39, 0, 0, 0, 100, // maximumPacketSize
  34, 1, 200, // topicAliasMaximum
  25, 1, // requestResponseInformation
  23, 1, // requestProblemInformation,
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties,
  21, 0, 4, 116, 101, 115, 116, // authenticationMethod
  22, 0, 4, 1, 2, 3, 4, // authenticationData
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  47, // will properties
  24, 0, 0, 4, 210, // will delay interval
  1, 0, // payload format indicator
  2, 0, 0, 16, 225, // message expiry interval
  3, 0, 4, 116, 101, 115, 116, // content type
  8, 0, 5, 116, 111, 112, 105, 99, // response topic
  9, 0, 4, 1, 2, 3, 4, // corelation data
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // user properties
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 4, // Will payload length
  4, 3, 2, 1// Will payload
]))

testParseGenerate('connect MQTT 5 with will properties but with empty will payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 121,
  protocolId: 'MQTT',
  protocolVersion: 5,
  will: {
    retain: true,
    qos: 2,
    properties: {
      willDelayInterval: 1234,
      payloadFormatIndicator: false,
      messageExpiryInterval: 4321,
      contentType: 'test',
      responseTopic: 'topic',
      correlationData: Buffer.from([1, 2, 3, 4]),
      userProperties: {
        test: 'test'
      }
    },
    topic: 'topic',
    payload: Buffer.from([])
  },
  clean: true,
  keepalive: 30,
  properties: {
    sessionExpiryInterval: 1234,
    receiveMaximum: 432,
    maximumPacketSize: 100,
    topicAliasMaximum: 456,
    requestResponseInformation: true,
    requestProblemInformation: true,
    userProperties: {
      test: 'test'
    },
    authenticationMethod: 'test',
    authenticationData: Buffer.from([1, 2, 3, 4])
  },
  clientId: 'test'
}, Buffer.from([
  16, 121, // Header
  0, 4, // Protocol ID length
  77, 81, 84, 84, // Protocol ID
  5, // Protocol version
  54, // Connect flags
  0, 30, // Keepalive
  47, // properties length
  17, 0, 0, 4, 210, // sessionExpiryInterval
  33, 1, 176, // receiveMaximum
  39, 0, 0, 0, 100, // maximumPacketSize
  34, 1, 200, // topicAliasMaximum
  25, 1, // requestResponseInformation
  23, 1, // requestProblemInformation,
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties,
  21, 0, 4, 116, 101, 115, 116, // authenticationMethod
  22, 0, 4, 1, 2, 3, 4, // authenticationData
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  47, // will properties
  24, 0, 0, 4, 210, // will delay interval
  1, 0, // payload format indicator
  2, 0, 0, 16, 225, // message expiry interval
  3, 0, 4, 116, 101, 115, 116, // content type
  8, 0, 5, 116, 111, 112, 105, 99, // response topic
  9, 0, 4, 1, 2, 3, 4, // corelation data
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // user properties
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 0 // Will payload length
]))

testParseGenerate('connect MQTT 5 w/o will properties', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 78,
  protocolId: 'MQTT',
  protocolVersion: 5,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: Buffer.from([4, 3, 2, 1])
  },
  clean: true,
  keepalive: 30,
  properties: {
    sessionExpiryInterval: 1234,
    receiveMaximum: 432,
    maximumPacketSize: 100,
    topicAliasMaximum: 456,
    requestResponseInformation: true,
    requestProblemInformation: true,
    userProperties: {
      test: 'test'
    },
    authenticationMethod: 'test',
    authenticationData: Buffer.from([1, 2, 3, 4])
  },
  clientId: 'test'
}, Buffer.from([
  16, 78, // Header
  0, 4, // Protocol ID length
  77, 81, 84, 84, // Protocol ID
  5, // Protocol version
  54, // Connect flags
  0, 30, // Keepalive
  47, // properties length
  17, 0, 0, 4, 210, // sessionExpiryInterval
  33, 1, 176, // receiveMaximum
  39, 0, 0, 0, 100, // maximumPacketSize
  34, 1, 200, // topicAliasMaximum
  25, 1, // requestResponseInformation
  23, 1, // requestProblemInformation,
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties,
  21, 0, 4, 116, 101, 115, 116, // authenticationMethod
  22, 0, 4, 1, 2, 3, 4, // authenticationData
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, // will properties
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 4, // Will payload length
  4, 3, 2, 1// Will payload
]))

testParseGenerate('no clientId with 3.1.1', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 12,
  protocolId: 'MQTT',
  protocolVersion: 4,
  clean: true,
  keepalive: 30,
  clientId: ''
}, Buffer.from([
  16, 12, // Header
  0, 4, // Protocol ID length
  77, 81, 84, 84, // Protocol ID
  4, // Protocol version
  2, // Connect flags
  0, 30, // Keepalive
  0, 0 // Client ID length
]))

testParseGenerateDefaults('no clientId with 5.0', {
  cmd: 'connect',
  protocolId: 'MQTT',
  protocolVersion: 5,
  clean: true,
  keepalive: 60,
  properties:
  {
    receiveMaximum: 20
  },
  clientId: ''
}, Buffer.from(
  [16, 16, 0, 4, 77, 81, 84, 84, 5, 2, 0, 60, 3, 33, 0, 20, 0, 0]
), {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 16,
  topic: null,
  payload: null,
  protocolId: 'MQTT',
  protocolVersion: 5,
  clean: true,
  keepalive: 60,
  properties: {
    receiveMaximum: 20
  },
  clientId: ''
}, { protocolVersion: 5 })

testParseGenerateDefaults('utf-8 clientId with 5.0', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 23,
  protocolId: 'MQTT',
  protocolVersion: 4,
  clean: true,
  keepalive: 30,
  clientId: 'Ŧėśt🜄'
}, Buffer.from([
  16, 23, // Header
  0, 4, // Protocol ID length
  77, 81, 84, 84, // Protocol ID
  4, // Protocol version
  2, // Connect flags
  0, 30, // Keepalive
  0, 11, // Client ID length
  197, 166, // Ŧ (UTF-8: 0xc5a6)
  196, 151, // ė (UTF-8: 0xc497)
  197, 155, // ś (utf-8: 0xc59b)
  116, // t (utf-8: 0x74)
  240, 159, 156, 132 // 🜄 (utf-8: 0xf09f9c84)
]), {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 23,
  topic: null,
  payload: null,
  protocolId: 'MQTT',
  protocolVersion: 4,
  clean: true,
  keepalive: 30,
  clientId: 'Ŧėśt🜄'
}, { protocol: 5 })

testParseGenerateDefaults('default connect', {
  cmd: 'connect',
  clientId: 'test'
}, Buffer.from([
  16, 16, 0, 4, 77, 81, 84,
  84, 4, 2, 0, 0,
  0, 4, 116, 101, 115, 116
]), {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 16,
  topic: null,
  payload: null,
  protocolId: 'MQTT',
  protocolVersion: 4,
  clean: true,
  keepalive: 0,
  clientId: 'test'
})

testParseAndGenerate('Version 4 CONACK', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  topic: null,
  payload: null,
  sessionPresent: false,
  returnCode: 1
}, Buffer.from([
  32, 2, // Fixed Header (CONNACK, Remaining Length)
  0, 1 // Variable Header (Session not present, Connection Refused - unacceptable protocol version)
]), {}) // Default protocolVersion (4)

testParseAndGenerate('Version 5 CONACK', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 3,
  topic: null,
  payload: null,
  sessionPresent: false,
  reasonCode: 140
}, Buffer.from([
  32, 3, // Fixed Header (CONNACK, Remaining Length)
  0, 140, // Variable Header (Session not present, Bad authentication method)
  0 // Property Length Zero
]), { protocolVersion: 5 })

testParseOnly('Version 4 CONACK in Version 5 mode', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  topic: null,
  payload: null,
  sessionPresent: false,
  reasonCode: 1 // a version 4 return code stored in the version 5 reasonCode because this client is in version 5
}, Buffer.from([
  32, 2, // Fixed Header (CONNACK, Remaining Length)
  0, 1 // Variable Header (Session not present, Connection Refused - unacceptable protocol version)
]), { protocolVersion: 5 }) // message is in version 4 format, but this client is in version 5 mode

testParseOnly('Version 5 PUBACK test 1', {
  cmd: 'puback',
  messageId: 42,
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  64, 2, // Fixed Header (PUBACK, Remaining Length)
  0, 42 // Variable Header (2 Bytes: Packet Identifier 42, Implied Reason code: Success, Implied no properties)
]), { protocolVersion: 5 }
)

testParseAndGenerate('Version 5 PUBACK test 2', {
  cmd: 'puback',
  messageId: 42,
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  64, 2, // Fixed Header (PUBACK, Remaining Length)
  0, 42 // Variable Header (2 Bytes: Packet Identifier 42, Implied reason code: 0 Success, Implied no properties)
]), { protocolVersion: 5 }
)

testParseOnly('Version 5 PUBACK test 2.1', {
  cmd: 'puback',
  messageId: 42,
  retain: false,
  qos: 0,
  dup: false,
  length: 3,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  64, 3, // Fixed Header (PUBACK, Remaining Length)
  0, 42, 0 // Variable Header (2 Bytes: Packet Identifier 42, Reason code: 0 Success, Implied no properties)
]), { protocolVersion: 5 }
)

testParseOnly('Version 5 PUBACK test 3', {
  cmd: 'puback',
  messageId: 42,
  retain: false,
  qos: 0,
  dup: false,
  length: 4,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  64, 4, // Fixed Header (PUBACK, Remaining Length)
  0, 42, 0, // Variable Header (2 Bytes: Packet Identifier 42, Reason code: 0 Success)
  0 // no properties
]), { protocolVersion: 5 }
)

// A CONNACK always carries Connect Acknowledge Flags and a reason code
// (MQTT-5 §3.2.2). With only the flags byte there is no reason code to report,
// and defaulting it to Success would tell the client an unauthenticated
// connection was accepted - so remaining length 1 is rejected.
testParseError('Malformed connack, packet too short', Buffer.from([
  32, 1, // Fixed Header (CONNACK, Remaining Length 1)
  1 // Connect Acknowledge Flags (session present), and nothing else
]), { protocolVersion: 5 })

testParseOnly('Version 5 CONNACK test 2', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  topic: null,
  payload: null,
  sessionPresent: true,
  reasonCode: 0
}, Buffer.from([
  32, 2, // Fixed Header (CONNACK, Remaining Length)
  1, 0 // Variable Header (Session Present: 1 => true, Connect Reason code: Success, Implied no properties)
]), { protocolVersion: 5 }
)

testParseAndGenerate('Version 5 CONNACK test 3', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 3,
  topic: null,
  payload: null,
  sessionPresent: true,
  reasonCode: 0
}, Buffer.from([
  32, 3, // Fixed Header (CONNACK, Remaining Length)
  1, 0, // Variable Header (Session Present: 1 => true, Connect Reason code: Success)
  0 // no properties
]), { protocolVersion: 5 }
)

testParseOnly('Version 5 DISCONNECT test 1', {
  cmd: 'disconnect',
  retain: false,
  qos: 0,
  dup: false,
  length: 0,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  224, 0 // Fixed Header (DISCONNECT, Remaining Length), Implied Reason code: Normal Disconnection
]), { protocolVersion: 5 }
)

testParseOnly('Version 5 DISCONNECT test 2', {
  cmd: 'disconnect',
  retain: false,
  qos: 0,
  dup: false,
  length: 1,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  224, 1, // Fixed Header (DISCONNECT, Remaining Length)
  0 // reason Code (Normal disconnection)
]), { protocolVersion: 5 }
)

// A packet's reason code and property block are bounded by its own remaining
// length, not by the parse buffer, so a pipelined packet that follows is never
// read as part of this one. Reading past the boundary is a Malformed Packet
// (MQTT-5 §4.13): every such read errors rather than yielding a silent
// null/-1, which is what the error cases below pin down.
const PINGREQ = [0xC0, 0x00] // Fixed Header (PINGREQ, Remaining Length 0)

test('reason code and properties stop at the packet boundary when pipelined', t => {
  const cases = [
    {
      what: 'DISCONNECT remaining length 0, implied reason code',
      bytes: [0xE0, 0x00], // Fixed Header (DISCONNECT, Remaining Length 0)
      cmd: 'disconnect',
      rc: 0
    },
    {
      what: 'DISCONNECT remaining length 1, reason code only',
      bytes: [
        0xE0, 0x01, // Fixed Header (DISCONNECT, Remaining Length 1)
        0x80 // reason code (Unspecified error)
      ],
      cmd: 'disconnect',
      rc: 0x80
    },
    {
      what: 'DISCONNECT remaining length 2, empty property block',
      bytes: [
        0xE0, 0x02, // Fixed Header (DISCONNECT, Remaining Length 2)
        0x00, // reason code (Normal disconnection)
        0x00 // Property Length 0
      ],
      cmd: 'disconnect',
      rc: 0
    },
    {
      what: 'DISCONNECT remaining length 7, one property',
      bytes: [
        0xE0, 0x07, // Fixed Header (DISCONNECT, Remaining Length 7)
        0x00, // reason code (Normal disconnection)
        0x05, // Property Length 5
        0x11, 0x00, 0x00, 0x00, 0x0A // property: sessionExpiryInterval (int32) = 10
      ],
      cmd: 'disconnect',
      rc: 0,
      props: { sessionExpiryInterval: 10 }
    },
    {
      what: 'AUTH remaining length 0, implied reason code',
      bytes: [0xF0, 0x00], // Fixed Header (AUTH, Remaining Length 0)
      cmd: 'auth',
      rc: 0
    },
    {
      what: 'AUTH remaining length 1, reason code only',
      bytes: [
        0xF0, 0x01, // Fixed Header (AUTH, Remaining Length 1)
        0x18 // reason code (Continue authentication)
      ],
      cmd: 'auth',
      rc: 0x18
    },
    {
      what: 'AUTH remaining length 2, empty property block',
      bytes: [
        0xF0, 0x02, // Fixed Header (AUTH, Remaining Length 2)
        0x00, // reason code (Success)
        0x00 // Property Length 0
      ],
      cmd: 'auth',
      rc: 0
    },
    {
      what: 'AUTH remaining length 6, a binary property',
      bytes: [
        0xF0, 0x06, // Fixed Header (AUTH, Remaining Length 6)
        0x18, // reason code (Continue authentication)
        0x04, // Property Length 4
        0x16, 0x00, 0x01, 0xAA // property: authenticationData (binary) = <AA>
      ],
      cmd: 'auth',
      rc: 0x18,
      props: { authenticationData: Buffer.from([0xAA]) }
    },
    {
      what: 'AUTH remaining length 7, a string property',
      bytes: [
        0xF0, 0x07, // Fixed Header (AUTH, Remaining Length 7)
        0x18, // reason code (Continue authentication)
        0x05, // Property Length 5
        0x1F, 0x00, 0x02, 0x68, 0x69 // property: reasonString = 'hi'
      ],
      cmd: 'auth',
      rc: 0x18,
      props: { reasonString: 'hi' }
    },
    {
      // The 2-byte form is what 'Version 4 CONACK in Version 5 mode' documents:
      // a v4-only server refusing a v5 CONNECT. The point here is that a
      // following packet no longer supplies the missing property length.
      what: 'CONNACK remaining length 2, version 4 format',
      bytes: [
        0x20, 0x02, // Fixed Header (CONNACK, Remaining Length 2)
        0x00, // Connect Acknowledge Flags (session not present)
        0x01 // reason code (Unacceptable protocol version)
      ],
      cmd: 'connack',
      rc: 1
    },
    {
      what: 'CONNACK remaining length 3, empty property block',
      bytes: [
        0x20, 0x03, // Fixed Header (CONNACK, Remaining Length 3)
        0x00, // Connect Acknowledge Flags (session not present)
        0x00, // reason code (Success)
        0x00 // Property Length 0
      ],
      cmd: 'connack',
      rc: 0
    },
    {
      what: 'CONNACK remaining length 6, one property',
      bytes: [
        0x20, 0x06, // Fixed Header (CONNACK, Remaining Length 6)
        0x00, // Connect Acknowledge Flags (session not present)
        0x00, // reason code (Success)
        0x03, // Property Length 3
        0x21, 0x00, 0x0A // property: receiveMaximum (int16) = 10
      ],
      cmd: 'connack',
      rc: 0,
      props: { receiveMaximum: 10 }
    }
  ]
  t.plan(cases.length * 5)
  for (const c of cases) {
    const parser = mqtt.parser({ protocolVersion: 5 })
    const packets = []
    parser.on('packet', p => packets.push(p))
    parser.on('error', e => t.fail(`${c.what}: unexpected error ${e.message}`))
    const remaining = parser.parse(Buffer.from([...c.bytes, ...PINGREQ]))
    t.deepEqual(packets.map(p => p.cmd), [c.cmd, 'pingreq'], `${c.what}: both packets parsed`)
    t.equal(packets[0] && packets[0].reasonCode, c.rc, `${c.what}: reason code`)
    t.deepEqual(packets[0] && packets[0].properties, c.props, `${c.what}: properties`)
    t.equal(packets[1] && packets[1].cmd, 'pingreq', `${c.what}: pingreq intact`)
    t.equal(remaining, 0, `${c.what}: no bytes left over`)
  }
})

// A declared Property Length that runs past the remaining length used to
// absorb the following packet's header bytes into a property value.
testParseError('Malformed disconnect, property length exceeds remaining length', Buffer.from([
  0xE0, 0x03, // Fixed Header (DISCONNECT, Remaining Length 3)
  0x00, // reason code (Normal disconnection)
  0x02, // Property Length 2, but only 1 byte is left in this packet
  0x01, // property: payloadFormatIndicator
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed auth, property length exceeds remaining length', Buffer.from([
  0xF0, 0x03, // Fixed Header (AUTH, Remaining Length 3)
  0x00, // reason code (Success)
  0x02, // Property Length 2, but only 1 byte is left in this packet
  0x01, // property: payloadFormatIndicator
  ...PINGREQ
]), { protocolVersion: 5 })

// A Property Length varint whose continuation bit runs into the next packet.
testParseError('Malformed disconnect, invalid variable byte integer', Buffer.from([
  0xE0, 0x02, // Fixed Header (DISCONNECT, Remaining Length 2)
  0x00, // reason code (Normal disconnection)
  0x80, // Property Length, continuation bit set with no byte after it
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed auth, invalid variable byte integer', Buffer.from([
  0xF0, 0x02, // Fixed Header (AUTH, Remaining Length 2)
  0x18, // reason code (Continue authentication)
  0x80, // Property Length, continuation bit set with no byte after it
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed connack, invalid variable byte integer', Buffer.from([
  0x20, 0x03, // Fixed Header (CONNACK, Remaining Length 3)
  0x00, // Connect Acknowledge Flags (session not present)
  0x00, // reason code (Success)
  0x80, // Property Length, continuation bit set with no byte after it
  ...PINGREQ
]), { protocolVersion: 5 })

// A property value that straddles the boundary: _parseNum, _parse4ByteNum and
// _parseBuffer stop at it, and the stop is reported rather than left as null.
testParseError('Malformed disconnect, property receiveMaximum exceeds the property length', Buffer.from([
  0xE0, 0x04, // Fixed Header (DISCONNECT, Remaining Length 4)
  0x00, // reason code (Normal disconnection)
  0x02, // Property Length 2
  0x21, 0x00, // property: receiveMaximum (int16) missing its second byte
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed disconnect, property sessionExpiryInterval exceeds the property length', Buffer.from([
  0xE0, 0x05, // Fixed Header (DISCONNECT, Remaining Length 5)
  0x00, // reason code (Normal disconnection)
  0x03, // Property Length 3
  0x11, 0x00, 0x00, // property: sessionExpiryInterval (int32) missing two bytes
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed disconnect, property authenticationData exceeds the property length', Buffer.from([
  0xE0, 0x05, // Fixed Header (DISCONNECT, Remaining Length 5)
  0x00, // reason code (Normal disconnection)
  0x03, // Property Length 3
  0x16, 0x00, 0x05, // property: authenticationData declaring 5 bytes it does not have
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed disconnect, property userProperties exceeds the property length', Buffer.from([
  0xE0, 0x06, // Fixed Header (DISCONNECT, Remaining Length 6)
  0x00, // reason code (Normal disconnection)
  0x04, // Property Length 4
  0x26, 0x00, 0x01, 0x61, // property: userProperties, name 'a' with no value
  ...PINGREQ
]), { protocolVersion: 5 })

// A messageId that straddles the boundary used to be emitted as -1, or as two
// bytes stolen from the next packet.
testParseError('Malformed puback, cannot parse messageId', Buffer.from([
  0x40, 0x01, // Fixed Header (PUBACK, Remaining Length 1)
  0x00, // half a messageId
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed suback, cannot parse messageId', Buffer.from([
  0x90, 0x01, // Fixed Header (SUBACK, Remaining Length 1)
  0x00, // half a messageId
  ...PINGREQ
]), { protocolVersion: 5 })

// A CONNACK with no Connect Acknowledge Flags byte must be rejected, not
// emitted as an empty packet with the next packet's byte for flags.
testParseError('Malformed connack, packet too short', Buffer.from([
  0x20, 0x00, // Fixed Header (CONNACK, Remaining Length 0)
  ...PINGREQ
]), { protocolVersion: 5 })

// An invalid reason code must stop parsing, not fall through into the property
// block and emit a second error (mirrors _parseAuth's return).
testParseError('Invalid disconnect reason code', Buffer.from([
  0xE0, 0x03, // Fixed Header (DISCONNECT, Remaining Length 3)
  0x03, // reason code, not a valid DISCONNECT code
  0x01, 0x99 // Property Length 1, property: unknown
]), { protocolVersion: 5 })

// The version and connect-flags gates used _list.length, so a following
// packet's byte was read as protocolVersion/flags instead of erroring.
testParseError('Packet too short', Buffer.from([
  0x10, 0x06, // Fixed Header (CONNECT, Remaining Length 6)
  0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, // protocol name 'MQTT', then nothing
  ...PINGREQ
]), { protocolVersion: 4 })

// Every packet type that reads a property block stops on a malformed one. Each
// case declares a Property Length longer than the bytes left in the packet, so
// it exercises that type's own `_parsePropertiesInto` call site.
testParseError('Malformed connect, property length exceeds remaining length', Buffer.from([
  0x10, 0x0D, // Fixed Header (CONNECT, Remaining Length 13)
  0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, // protocol name 'MQTT'
  0x05, // protocol version 5
  0x02, // connect flags (clean start)
  0x00, 0x3C, // keepalive 60
  0x05, // Property Length 5, with 2 bytes left in the packet
  0x00, 0x00,
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed connect, property length exceeds remaining length', Buffer.from([
  0x10, 0x0E, // Fixed Header (CONNECT, Remaining Length 14)
  0x00, 0x04, 0x4D, 0x51, 0x54, 0x54, // protocol name 'MQTT'
  0x05, // protocol version 5
  0x04, // connect flags (will)
  0x00, 0x3C, // keepalive 60
  0x00, // Property Length 0
  0x00, 0x00, // clientId ''
  0x05, // will Property Length 5, with nothing left in the packet
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed publish, property length exceeds remaining length', Buffer.from([
  0x30, 0x07, // Fixed Header (PUBLISH, Remaining Length 7)
  0x00, 0x04, 0x74, 0x65, 0x73, 0x74, // topic 'test'
  0x05, // Property Length 5, with nothing left in the packet
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed subscribe, property length exceeds remaining length', Buffer.from([
  0x82, 0x03, // Fixed Header (SUBSCRIBE, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x05, // Property Length 5, with nothing left in the packet
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed suback, property length exceeds remaining length', Buffer.from([
  0x90, 0x03, // Fixed Header (SUBACK, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x05, // Property Length 5, with nothing left in the packet
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed unsubscribe, property length exceeds remaining length', Buffer.from([
  0xA2, 0x03, // Fixed Header (UNSUBSCRIBE, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x05, // Property Length 5, with nothing left in the packet
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed unsuback, property length exceeds remaining length', Buffer.from([
  0xB0, 0x03, // Fixed Header (UNSUBACK, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x05, // Property Length 5, with nothing left in the packet
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed puback, property length exceeds remaining length', Buffer.from([
  0x40, 0x05, // Fixed Header (PUBACK, Remaining Length 5)
  0x00, 0x01, // messageId 1
  0x00, // reason code (Success)
  0x05, // Property Length 5, with 1 byte left in the packet
  0x00,
  ...PINGREQ
]), { protocolVersion: 5 })

// A property value must stay inside the Property Length, not just inside the
// packet: otherwise it reads the packet's own body and silently re-frames every
// field after it.
testParseError('Malformed subscribe, property payloadFormatIndicator exceeds the property length', Buffer.from([
  0x82, 0x0D, // Fixed Header (SUBSCRIBE, Remaining Length 13)
  0x00, 0x01, // messageId 1
  0x01, // Property Length 1
  0x01, 0xFF, // property: payloadFormatIndicator, 2 bytes in a 1-byte block
  0x00, 0x05, 0x61, 0x2F, 0x62, 0x2F, 0x63, // topic 'a/b/c'
  0x00 // subscription options
]), { protocolVersion: 5 })

testParseError('Malformed auth, property authenticationMethod exceeds the property length', Buffer.from([
  0xF0, 0x09, // Fixed Header (AUTH, Remaining Length 9)
  0x18, // reason code (Continue authentication)
  0x01, // Property Length 1
  0x15, 0x00, 0x04, 0x74, 0x65, 0x73, 0x74 // property: authenticationMethod 'test', 7 bytes in a 1-byte block
]), { protocolVersion: 5 })

testParseError('Malformed publish, property sessionExpiryInterval exceeds the property length', Buffer.from([
  0x30, 0x0A, // Fixed Header (PUBLISH, Remaining Length 10)
  0x00, 0x01, 0x61, // topic 'a'
  0x03, // Property Length 3
  0x11, 0x00, 0x00, // property: sessionExpiryInterval (int32), 5 bytes in a 3-byte block
  0x01, 0x02, 0x03 // payload
]), { protocolVersion: 5 })

testParseError('Malformed publish, invalid variable byte integer', Buffer.from([
  0x30, 0x09, // Fixed Header (PUBLISH, Remaining Length 9)
  0x00, 0x01, 0x61, // topic 'a'
  0x02, // Property Length 2
  0x0B, 0x85, // property: subscriptionIdentifier, a varint continuing past the block
  0x01, 0x02, 0x03 // payload
]), { protocolVersion: 5 })

// The Property Length byte is mandatory in a v5 PUBLISH/SUBACK/UNSUBACK
// (MQTT-5 §3.3.2.3 / §3.9.2.1.1 / §3.11.2.1.1) - unlike DISCONNECT and AUTH,
// where the spec lets it be omitted below remaining length 2. These used to
// parse as packets with no properties and an empty payload.
testParseError('Malformed publish, invalid variable byte integer', Buffer.from([
  0x30, 0x03, // Fixed Header (PUBLISH, Remaining Length 3)
  0x00, 0x01, 0x61 // topic 'a', and no Property Length
]), { protocolVersion: 5 })

testParseError('Malformed suback, invalid variable byte integer', Buffer.from([
  0x90, 0x02, // Fixed Header (SUBACK, Remaining Length 2)
  0x00, 0x01 // messageId 1, and no Property Length
]), { protocolVersion: 5 })

testParseError('Malformed unsuback, invalid variable byte integer', Buffer.from([
  0xB0, 0x02, // Fixed Header (UNSUBACK, Remaining Length 2)
  0x00, 0x01 // messageId 1, and no Property Length
]), { protocolVersion: 5 })

// A SUBACK/UNSUBACK carries one reason code per subscription, and a
// SUBSCRIBE/UNSUBSCRIBE at least one topic filter (MQTT-5 §3.9.3, §3.11.3,
// [MQTT-3.8.3-3], [MQTT-3.10.3-2]). Without these a property block that eats the
// payload parses as a packet with an empty list and no error at all - the same
// silent accept this change is about, one field further on.
testParseError('Malformed suback, no reason codes specified', Buffer.from([
  0x90, 0x03, // Fixed Header (SUBACK, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x00, // Property Length 0, and no reason codes after it
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed suback, no reason codes specified', Buffer.from([
  0x90, 0x08, // Fixed Header (SUBACK, Remaining Length 8)
  0x00, 0x01, // messageId 1
  0x05, // Property Length 5
  0x1F, 0x00, 0x02, 0x68, 0x69, // property: reasonString 'hi', filling the packet
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed suback, no reason codes specified', Buffer.from([
  0x90, 0x02, // Fixed Header (SUBACK, Remaining Length 2)
  0x00, 0x01, // messageId 1, and no return codes
  ...PINGREQ
]), { protocolVersion: 4 })

testParseError('Malformed unsuback, no reason codes specified', Buffer.from([
  0xB0, 0x03, // Fixed Header (UNSUBACK, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x00, // Property Length 0, and no reason codes after it
  ...PINGREQ
]), { protocolVersion: 5 })

// A single byte left is not a topic filter but it is not nothing either: the
// loop must enter and fail on the truncated filter, rather than stop short and
// report an empty list.
testParseError('Cannot parse topic', Buffer.from([
  0x82, 0x04, // Fixed Header (SUBSCRIBE, Remaining Length 4)
  0x00, 0x01, // messageId 1
  0x00, // Property Length 0
  0x00, // one byte where a topic filter should start
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Cannot parse topic', Buffer.from([
  0xA2, 0x04, // Fixed Header (UNSUBSCRIBE, Remaining Length 4)
  0x00, 0x01, // messageId 1
  0x00, // Property Length 0
  0x00, // one byte where a topic filter should start
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed subscribe, no topic filters specified', Buffer.from([
  0x82, 0x03, // Fixed Header (SUBSCRIBE, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x00, // Property Length 0, and no topic filters after it
  ...PINGREQ
]), { protocolVersion: 5 })

testParseError('Malformed unsubscribe, no topic filters specified', Buffer.from([
  0xA2, 0x03, // Fixed Header (UNSUBSCRIBE, Remaining Length 3)
  0x00, 0x01, // messageId 1
  0x00, // Property Length 0, and no topic filters after it
  ...PINGREQ
]), { protocolVersion: 5 })

test('parser errors carry a code and the packet type', t => {
  // The message text is the only discriminator a consumer had, and this change
  // rewrites several of them; `code` and `cmd` are what to match on instead.
  t.plan(3)
  const parser = mqtt.parser({ protocolVersion: 5 })
  parser.on('packet', () => t.fail('no packet from a malformed input'))
  parser.on('error', err => {
    t.equal(err.code, 'MALFORMED_PACKET', 'code')
    t.equal(err.cmd, 'disconnect', 'cmd')
    t.ok(err instanceof Error, 'still an Error')
  })
  parser.parse(Buffer.from([0xE0, 0x03, 0x00, 0x02, 0x01]))
})

// A failed property read must stop the packet's parser before it reads the
// fields that follow the property block. End to end this is invisible:
// `_parsePropertiesInto` emits, and `parse()` refuses to emit a packet while
// `this.error` is set, so dropping a guard changes nothing observable. Failing
// the read WITHOUT setting the error isolates it: with the guard those fields
// are never assigned, without it they are read from an offset now pointing into
// the middle of the property block (a PUBLISH payload comes back as the
// property bytes plus the real payload).
//
// CONNACK, PUBACK, DISCONNECT and AUTH read their properties last, so their
// guards have nothing to stop and no test can distinguish them. They are here
// for consistency, and this test covers the seven that do.
test('a failed property read stops before the fields that follow it', t => {
  const cases = [
    {
      what: 'connect packet properties',
      call: 1,
      packet: { cmd: 'connect', protocolVersion: 5, clientId: 'c', properties: { sessionExpiryInterval: 1 } },
      untouched: p => !p || p.clientId === undefined
    },
    {
      what: 'connect will properties',
      call: 2,
      packet: { cmd: 'connect', protocolVersion: 5, clientId: 'c', will: { topic: 't', payload: Buffer.from('p'), properties: { willDelayInterval: 1 } } },
      untouched: p => !p || !p.will || p.will.topic === undefined
    },
    {
      what: 'publish',
      call: 1,
      packet: { cmd: 'publish', topic: 't', payload: Buffer.from('p'), properties: { payloadFormatIndicator: true } },
      untouched: p => !p || p.payload === null || p.payload === undefined
    },
    {
      what: 'subscribe',
      call: 1,
      packet: { cmd: 'subscribe', messageId: 1, subscriptions: [{ topic: 't', qos: 0 }], properties: { subscriptionIdentifier: 1 } },
      untouched: p => !p || !p.subscriptions || p.subscriptions.length === 0
    },
    {
      what: 'suback',
      call: 1,
      packet: { cmd: 'suback', messageId: 1, granted: [0], properties: { reasonString: 'r' } },
      untouched: p => !p || !p.granted || p.granted.length === 0
    },
    {
      what: 'unsubscribe',
      call: 1,
      packet: { cmd: 'unsubscribe', messageId: 1, unsubscriptions: ['t'], properties: { reasonString: 'r' } },
      untouched: p => !p || !p.unsubscriptions || p.unsubscriptions.length === 0
    },
    {
      what: 'unsuback',
      call: 1,
      packet: { cmd: 'unsuback', messageId: 1, granted: [0], properties: { reasonString: 'r' } },
      untouched: p => !p || !p.granted || p.granted.length === 0
    }
  ]
  t.plan(cases.length * 4)
  for (const c of cases) {
    const fixture = mqtt.generate(c.packet, { protocolVersion: 5 })

    // The unmodified parser must accept the fixture, or the case proves nothing
    const control = mqtt.parser({ protocolVersion: 5 })
    let controlPacket = null
    control.on('packet', p => { controlPacket = p })
    control.on('error', e => t.fail(`${c.what}: fixture is not valid: ${e.message}`))
    control.parse(fixture)
    t.ok(controlPacket && !c.untouched(controlPacket), `${c.what}: fixture parses in full`)

    const parser = mqtt.parser({ protocolVersion: 5 })
    const real = parser._parsePropertiesInto
    let calls = 0
    parser._parsePropertiesInto = function (target) {
      if (++calls === c.call) return false
      return real.call(this, target)
    }
    let got = null
    let errors = 0
    parser.on('packet', p => { got = p })
    parser.on('error', () => errors++)
    parser.parse(fixture)
    t.equal(calls, c.call, `${c.what}: no property read after the failing one`)
    t.ok(c.untouched(got), `${c.what}: the fields after the property block were never assigned`)
    // The stub reports no error, so any error here came from reading on past it
    t.equal(errors, 0, `${c.what}: no error raised past the failing property read`)
  }
})

test('the parser stays usable after a packet-boundary error', t => {
  // _resetState did not clear _pos, so the next packet's _parseVarByteNum used
  // the stale value as padding and computed a bogus remaining length.
  const fixtures = [
    // A malformed CONNECT that errors mid-payload, leaving _pos non-zero
    [0x10, 0x04, 0x00, 0x06, 0x4D, 0x51],
    // A DISCONNECT whose Property Length runs past its remaining length
    [0xE0, 0x03, 0x00, 0x02, 0x01],
    // A DISCONNECT whose property value straddles the boundary
    [0xE0, 0x04, 0x00, 0x02, 0x21, 0x00]
  ]
  t.plan(fixtures.length * 4)
  for (const bytes of fixtures) {
    const parser = mqtt.parser({ protocolVersion: 5 })
    const packets = []
    let errors = 0
    parser.on('packet', p => packets.push(p))
    parser.on('error', () => errors++)
    parser.parse(Buffer.from(bytes))
    t.equal(packets.length, 0, 'no packet from the malformed input')
    t.equal(errors, 1, 'exactly one error')
    // A following valid PUBLISH must parse cleanly rather than wedge
    const remaining = parser.parse(Buffer.from([
      0x30, 0x0B, // Fixed Header (PUBLISH, Remaining Length 11)
      0x00, 0x04, 0x74, 0x65, 0x73, 0x74, // topic 'test'
      0x00, // Property Length 0
      0x74, 0x65, 0x73, 0x74 // payload 'test'
    ]))
    t.equal(packets[0] && packets[0].topic, 'test', 'the following publish parses')
    t.equal(remaining, 0, 'no bytes left over')
  }
})

testParseAndGenerate('Version 5 DISCONNECT test 3', {
  cmd: 'disconnect',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  224, 2, // Fixed Header (DISCONNECT, Remaining Length)
  0, // reason Code (Normal disconnection)
  0 // no properties
]), { protocolVersion: 5 }
)

testParseGenerate('empty will payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 47,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: Buffer.alloc(0)
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: Buffer.from('password')
}, Buffer.from([
  16, 47, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 0, // Will payload length
  // Will payload
  0, 8, // Username length
  117, 115, 101, 114, 110, 97, 109, 101, // Username
  0, 8, // Password length
  112, 97, 115, 115, 119, 111, 114, 100 // Password
]))

testParseGenerate('empty buffer username payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 20,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: Buffer.from('')
}, Buffer.from([
  16, 20, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  130, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 0 // Username length
  // Empty Username payload
]))

testParseGenerate('empty string username payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 20,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: ''
}, Buffer.from([
  16, 20, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  130, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 0 // Username length
  // Empty Username payload
]))

testParseGenerate('empty buffer password payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 30,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: Buffer.from('')
}, Buffer.from([
  16, 30, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  194, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 8, // Username length
  117, 115, 101, 114, 110, 97, 109, 101, // Username payload
  0, 0 // Password length
  // Empty password payload
]))

testParseGenerate('empty string password payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 30,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: ''
}, Buffer.from([
  16, 30, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  194, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 8, // Username length
  117, 115, 101, 114, 110, 97, 109, 101, // Username payload
  0, 0 // Password length
  // Empty password payload
]))

testParseGenerate('empty string username and password payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 22,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: '',
  password: Buffer.from('')
}, Buffer.from([
  16, 22, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  194, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 0, // Username length
  // Empty Username payload
  0, 0 // Password length
  // Empty password payload
]))

testParseGenerate('maximal connect', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: Buffer.from('payload')
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: Buffer.from('password')
}, Buffer.from([
  16, 54, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 7, // Will payload length
  112, 97, 121, 108, 111, 97, 100, // Will payload
  0, 8, // Username length
  117, 115, 101, 114, 110, 97, 109, 101, // Username
  0, 8, // Password length
  112, 97, 115, 115, 119, 111, 114, 100 // Password
]))

testParseGenerate('max connect with special chars', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 57,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'tòpic',
    payload: Buffer.from('pay£oad')
  },
  clean: true,
  keepalive: 30,
  clientId: 'te$t',
  username: 'u$ern4me',
  password: Buffer.from('p4$$w0£d')
}, Buffer.from([
  16, 57, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 36, 116, // Client ID
  0, 6, // Will topic length
  116, 195, 178, 112, 105, 99, // Will topic
  0, 8, // Will payload length
  112, 97, 121, 194, 163, 111, 97, 100, // Will payload
  0, 8, // Username length
  117, 36, 101, 114, 110, 52, 109, 101, // Username
  0, 9, // Password length
  112, 52, 36, 36, 119, 48, 194, 163, 100 // Password
]))

testGenerateOnly('connect all strings generate', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: 'password'
}, Buffer.from([
  16, 54, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116, // Client ID
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 7, // Will payload length
  112, 97, 121, 108, 111, 97, 100, // Will payload
  0, 8, // Username length
  117, 115, 101, 114, 110, 97, 109, 101, // Username
  0, 8, // Password length
  112, 97, 115, 115, 119, 111, 114, 100 // Password
]))

testParseError('Cannot parse protocolId', Buffer.from([
  16, 4,
  0, 6,
  77, 81
]))

// missing protocol version on connect
testParseError('Packet too short', Buffer.from([
  16, 8, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112 // Protocol ID
]))

// missing keepalive on connect
testParseError('Packet too short', Buffer.from([
  16, 10, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246 // Connect flags
]))

// missing clientid on connect
testParseError('Packet too short', Buffer.from([
  16, 10, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30 // Keepalive
]))

// missing will topic on connect
testParseError('Cannot parse will topic', Buffer.from([
  16, 16, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 2, // Will topic length
  0, 0 // Will topic
]))

// missing will payload on connect
testParseError('Cannot parse will payload', Buffer.from([
  16, 23, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 2, // Will payload length
  0, 0 // Will payload
]))

// missing username on connect
testParseError('Cannot parse username', Buffer.from([
  16, 32, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 7, // Will payload length
  112, 97, 121, 108, 111, 97, 100, // Will payload
  0, 2, // Username length
  0, 0 // Username
]))

// missing password on connect
testParseError('Cannot parse password', Buffer.from([
  16, 42, // Header
  0, 6, // Protocol ID length
  77, 81, 73, 115, 100, 112, // Protocol ID
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 5, // Will topic length
  116, 111, 112, 105, 99, // Will topic
  0, 7, // Will payload length
  112, 97, 121, 108, 111, 97, 100, // Will payload
  0, 8, // Username length
  117, 115, 101, 114, 110, 97, 109, 101, // Username
  0, 2, // Password length
  0, 0 // Password
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for connect packet', Buffer.from([
  18, 10, // Header
  0, 4, // Protocol ID length
  0x4d, 0x51, 0x54, 0x54, // Protocol ID
  3, // Protocol version
  2, // Connect flags
  0, 30 // Keepalive
]))

// The Server MUST validate that the reserved flag in the CONNECT Control Packet is set to zero and disconnect the Client if it is not zero [MQTT-3.1.2-3]
testParseError('Connect flag bit 0 must be 0, but got 1', Buffer.from([
  16, 10, // Header
  0, 4, // Protocol ID length
  0x4d, 0x51, 0x54, 0x54, // Protocol ID
  3, // Protocol version
  3, // Connect flags
  0, 30 // Keepalive
]))

// If the Will Flag is set to 0 the Will QoS and Will Retain fields in the Connect Flags MUST be set to zero and the Will Topic and Will Message fields MUST NOT be present in the payload [MQTT-3.1.2-11].
testParseError('Will Retain Flag must be set to zero when Will Flag is set to 0', Buffer.from([
  16, 10, // Header
  0, 4, // Protocol ID length
  0x4d, 0x51, 0x54, 0x54, // Protocol ID
  3, // Protocol version
  0x22, // Connect flags
  0, 30 // Keepalive
]))

// If the Will Flag is set to 0 the Will QoS and Will Retain fields in the Connect Flags MUST be set to zero and the Will Topic and Will Message fields MUST NOT be present in the payload [MQTT-3.1.2-11].
testParseError('Will QoS must be set to zero when Will Flag is set to 0', Buffer.from([
  16, 10, // Header
  0, 4, // Protocol ID length
  0x4d, 0x51, 0x54, 0x54, // Protocol ID
  3, // Protocol version
  0x12, // Connect flags
  0, 30 // Keepalive
]))

// If the Will Flag is set to 0 the Will QoS and Will Retain fields in the Connect Flags MUST be set to zero and the Will Topic and Will Message fields MUST NOT be present in the payload [MQTT-3.1.2-11].
testParseError('Will QoS must be set to zero when Will Flag is set to 0', Buffer.from([
  16, 10, // Header
  0, 4, // Protocol ID length
  0x4d, 0x51, 0x54, 0x54, // Protocol ID
  3, // Protocol version
  0xa, // Connect flags
  0, 30 // Keepalive
]))

// CONNECT, SUBSCRIBE, SUBACK, UNSUBSCRIBE, UNSUBACK (v.5) packets must have payload
// CONNECT
testParseError('Packet too short', Buffer.from([
  16, // Header
  8, // Packet length
  0, 4, // Protocol ID length
  77, 81, 84, 84, // MQTT
  5, // Version
  2, // Clean Start enabled
  0, 0, // Keep-Alive
  0, // Property Length
  0, 0 // Properties
  // No payload
]), { protocolVersion: 5 })
// SUBSCRIBE
testParseError('Malformed subscribe, no payload specified', Buffer.from([
  130, // Header
  0 // Packet length
]), { protocolVersion: 5 })
// SUBACK
testParseError('Malformed suback, no payload specified', Buffer.from([
  144, // Header
  0 // Packet length
]), { protocolVersion: 5 })
// UNSUBSCRIBE
testParseError('Malformed unsubscribe, no payload specified', Buffer.from([
  162, // Header
  0 // Packet length
]), { protocolVersion: 5 })
// UNSUBACK (v.5)
testParseError('Malformed unsuback, no payload specified', Buffer.from([
  176, // Header
  0 // Packet length
]), { protocolVersion: 5 })
// UNSUBACK (v.4)
testParseError('Malformed unsuback, payload length must be 2', Buffer.from([
  176, // Header
  1, // Packet length
  1
]), { protocolVersion: 4 })
// UNSUBACK (v.3)
testParseError('Malformed unsuback, payload length must be 2', Buffer.from([
  176, // Header
  1, // Packet length
  1
]), { protocolVersion: 3 })

testParseGenerate('connack with return code 0', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  sessionPresent: false,
  returnCode: 0
}, Buffer.from([
  32, 2, 0, 0
]))

testParseGenerate('connack MQTT 5 with properties', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 87,
  sessionPresent: false,
  reasonCode: 0,
  properties: {
    sessionExpiryInterval: 1234,
    receiveMaximum: 432,
    maximumQoS: 2,
    retainAvailable: true,
    maximumPacketSize: 100,
    assignedClientIdentifier: 'test',
    topicAliasMaximum: 456,
    reasonString: 'test',
    userProperties: {
      test: 'test'
    },
    wildcardSubscriptionAvailable: true,
    subscriptionIdentifiersAvailable: true,
    sharedSubscriptionAvailable: false,
    serverKeepAlive: 1234,
    responseInformation: 'test',
    serverReference: 'test',
    authenticationMethod: 'test',
    authenticationData: Buffer.from([1, 2, 3, 4])
  }
}, Buffer.from([
  32, 87, 0, 0,
  84, // properties length
  17, 0, 0, 4, 210, // sessionExpiryInterval
  33, 1, 176, // receiveMaximum
  36, 2, // Maximum qos
  37, 1, // retainAvailable
  39, 0, 0, 0, 100, // maximumPacketSize
  18, 0, 4, 116, 101, 115, 116, // assignedClientIdentifier
  34, 1, 200, // topicAliasMaximum
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  40, 1, // wildcardSubscriptionAvailable
  41, 1, // subscriptionIdentifiersAvailable
  42, 0, // sharedSubscriptionAvailable
  19, 4, 210, // serverKeepAlive
  26, 0, 4, 116, 101, 115, 116, // responseInformation
  28, 0, 4, 116, 101, 115, 116, // serverReference
  21, 0, 4, 116, 101, 115, 116, // authenticationMethod
  22, 0, 4, 1, 2, 3, 4 // authenticationData
]), { protocolVersion: 5 })

testParseGenerate('connack MQTT 5 with properties and doubled user properties', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 100,
  sessionPresent: false,
  reasonCode: 0,
  properties: {
    sessionExpiryInterval: 1234,
    receiveMaximum: 432,
    maximumQoS: 2,
    retainAvailable: true,
    maximumPacketSize: 100,
    assignedClientIdentifier: 'test',
    topicAliasMaximum: 456,
    reasonString: 'test',
    userProperties: {
      test: ['test', 'test']
    },
    wildcardSubscriptionAvailable: true,
    subscriptionIdentifiersAvailable: true,
    sharedSubscriptionAvailable: false,
    serverKeepAlive: 1234,
    responseInformation: 'test',
    serverReference: 'test',
    authenticationMethod: 'test',
    authenticationData: Buffer.from([1, 2, 3, 4])
  }
}, Buffer.from([
  32, 100, 0, 0,
  97, // properties length
  17, 0, 0, 4, 210, // sessionExpiryInterval
  33, 1, 176, // receiveMaximum
  36, 2, // Maximum qos
  37, 1, // retainAvailable
  39, 0, 0, 0, 100, // maximumPacketSize
  18, 0, 4, 116, 101, 115, 116, // assignedClientIdentifier
  34, 1, 200, // topicAliasMaximum
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116,
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  40, 1, // wildcardSubscriptionAvailable
  41, 1, // subscriptionIdentifiersAvailable
  42, 0, // sharedSubscriptionAvailable
  19, 4, 210, // serverKeepAlive
  26, 0, 4, 116, 101, 115, 116, // responseInformation
  28, 0, 4, 116, 101, 115, 116, // serverReference
  21, 0, 4, 116, 101, 115, 116, // authenticationMethod
  22, 0, 4, 1, 2, 3, 4 // authenticationData
]), { protocolVersion: 5 })

testParseGenerate('connack with return code 0 session present bit set', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  sessionPresent: true,
  returnCode: 0
}, Buffer.from([
  32, 2, 1, 0
]))

testParseGenerate('connack with return code 5', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  sessionPresent: false,
  returnCode: 5
}, Buffer.from([
  32, 2, 0, 5
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for connack packet', Buffer.from([
  33, 2, // header
  0, // flags
  5 // return code
]))

// Byte 1 is the "Connect Acknowledge Flags". Bits 7-1 are reserved and MUST be set to 0 [MQTT-3.2.2-1].
testParseError('Invalid connack flags, bits 7-1 must be set to 0', Buffer.from([
  32, 2, // header
  2, // flags
  5 // return code
]))

testGenerateError('Invalid return code', {
  cmd: 'connack',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  sessionPresent: false,
  returnCode: '5' // returncode must be a number
})

testParseGenerate('minimal publish', {
  cmd: 'publish',
  retain: false,
  qos: 0,
  dup: false,
  length: 10,
  topic: 'test',
  payload: Buffer.from('test')
}, Buffer.from([
  48, 10, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  116, 101, 115, 116 // Payload (test)
]))

testParseGenerate('publish MQTT 5 properties', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 86,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: true,
    messageExpiryInterval: 4321,
    topicAlias: 100,
    responseTopic: 'topic',
    correlationData: Buffer.from([1, 2, 3, 4]),
    userProperties: {
      test: ['test', 'test', 'test']
    },
    subscriptionIdentifier: 120,
    contentType: 'test'
  }
}, Buffer.from([
  61, 86, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  0, 10, // Message ID
  73, // properties length
  1, 1, // payloadFormatIndicator
  2, 0, 0, 16, 225, // message expiry interval
  35, 0, 100, // topicAlias
  8, 0, 5, 116, 111, 112, 105, 99, // response topic
  9, 0, 4, 1, 2, 3, 4, // correlationData
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  11, 120, // subscriptionIdentifier
  3, 0, 4, 116, 101, 115, 116, // content type
  116, 101, 115, 116 // Payload (test)
]), { protocolVersion: 5 })

testParseGenerate('publish MQTT 5 with multiple same properties', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 64,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: true,
    messageExpiryInterval: 4321,
    topicAlias: 100,
    responseTopic: 'topic',
    correlationData: Buffer.from([1, 2, 3, 4]),
    userProperties: {
      test: 'test'
    },
    subscriptionIdentifier: [120, 121, 122],
    contentType: 'test'
  }
}, Buffer.from([
  61, 64, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  0, 10, // Message ID
  51, // properties length
  1, 1, // payloadFormatIndicator
  2, 0, 0, 16, 225, // message expiry interval
  35, 0, 100, // topicAlias
  8, 0, 5, 116, 111, 112, 105, 99, // response topic
  9, 0, 4, 1, 2, 3, 4, // correlationData
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  11, 120, // subscriptionIdentifier
  11, 121, // subscriptionIdentifier
  11, 122, // subscriptionIdentifier
  3, 0, 4, 116, 101, 115, 116, // content type
  116, 101, 115, 116 // Payload (test)
]), { protocolVersion: 5 })

testParseGenerate('publish MQTT 5 with duplicate user property including empty-string value', {
  cmd: 'publish',
  retain: false,
  qos: 0,
  dup: false,
  length: 18,
  topic: 't',
  payload: Buffer.from('x'),
  properties: {
    userProperties: {
      a: ['', 'b']
    }
  }
}, Buffer.from([
  48, 18, // Header
  0, 1, 116, // Topic length + 't'
  13, // properties length
  38, 0, 1, 97, 0, 0, // userProperties a -> ''
  38, 0, 1, 97, 0, 1, 98, // userProperties a -> 'b'
  120 // Payload (x)
]), { protocolVersion: 5 })

testParseGenerate('publish MQTT 5 properties with 0-4 byte varbyte', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 27,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: false,
    subscriptionIdentifier: [128, 16384, 2097152] // this tests the varbyte handling
  }
}, Buffer.from([
  61, 27, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  0, 10, // Message ID
  14, // properties length
  1, 0, // payloadFormatIndicator
  11, 128, 1, // subscriptionIdentifier
  11, 128, 128, 1, // subscriptionIdentifier
  11, 128, 128, 128, 1, // subscriptionIdentifier
  116, 101, 115, 116 // Payload (test)
]), { protocolVersion: 5 })

testParseGenerate('publish MQTT 5 properties with max value varbyte', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 22,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: false,
    subscriptionIdentifier: [1, 268435455]
  }
}, Buffer.from([
  61, 22, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  0, 10, // Message ID
  9, // properties length
  1, 0, // payloadFormatIndicator
  11, 1, // subscriptionIdentifier
  11, 255, 255, 255, 127, // subscriptionIdentifier (max value)
  116, 101, 115, 116 // Payload (test)
]), { protocolVersion: 5 })

; (() => {
  const buffer = Buffer.alloc(2048)
  testParseGenerate('2KB publish packet', {
    cmd: 'publish',
    retain: false,
    qos: 0,
    dup: false,
    length: 2054,
    topic: 'test',
    payload: buffer
  }, Buffer.concat([Buffer.from([
    48, 134, 16, // Header
    0, 4, // Topic length
    116, 101, 115, 116 // Topic (test)
  ]), buffer]))
})()

; (() => {
  const maxLength = 268435455
  const buffer = Buffer.alloc(maxLength - 6)
  testParseGenerate('Max payload publish packet', {
    cmd: 'publish',
    retain: false,
    qos: 0,
    dup: false,
    length: maxLength,
    topic: 'test',
    payload: buffer
  }, Buffer.concat([Buffer.from([
    48, 255, 255, 255, 127, // Header
    0, 4, // Topic length
    116, 101, 115, 116 // Topic (test)
  ]), buffer]))
})()

testParseGenerate('maximal publish', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  length: 12,
  dup: true,
  topic: 'test',
  messageId: 10,
  payload: Buffer.from('test')
}, Buffer.from([
  61, 12, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic
  0, 10, // Message ID
  116, 101, 115, 116 // Payload
]))

test('publish all strings generate', t => {
  const message = {
    cmd: 'publish',
    retain: true,
    qos: 2,
    length: 12,
    dup: true,
    topic: 'test',
    messageId: 10,
    payload: Buffer.from('test')
  }
  const expected = Buffer.from([
    61, 12, // Header
    0, 4, // Topic length
    116, 101, 115, 116, // Topic
    0, 10, // Message ID
    116, 101, 115, 116 // Payload
  ])

  t.equal(mqtt.generate(message).toString('hex'), expected.toString('hex'))
  t.end()
})

testParseGenerate('empty publish', {
  cmd: 'publish',
  retain: false,
  qos: 0,
  dup: false,
  length: 6,
  topic: 'test',
  payload: Buffer.alloc(0)
}, Buffer.from([
  48, 6, // Header
  0, 4, // Topic length
  116, 101, 115, 116 // Topic
  // Empty payload
]))

// A PUBLISH Packet MUST NOT have both QoS bits set to 1. If a Server or Client receives a PUBLISH Packet which has both QoS bits set to 1 it MUST close the Network Connection [MQTT-3.3.1-4].
testParseError('Packet must not have both QoS bits set to 1', Buffer.from([
  0x36, 6, // Header
  0, 4, // Topic length
  116, 101, 115, 116 // Topic
  // Empty payload
]))

test('splitted publish parse', t => {
  t.plan(3)

  const parser = mqtt.parser()
  const expected = {
    cmd: 'publish',
    retain: false,
    qos: 0,
    dup: false,
    length: 10,
    topic: 'test',
    payload: Buffer.from('test')
  }

  parser.on('packet', packet => {
    t.deepLooseEqual(packet, expected, 'expected packet')
  })

  t.equal(parser.parse(Buffer.from([
    48, 10, // Header
    0, 4, // Topic length
    116, 101, 115, 116 // Topic (test)
  ])), 6, 'remaining bytes')

  t.equal(parser.parse(Buffer.from([
    116, 101, 115, 116 // Payload (test)
  ])), 0, 'remaining bytes')
})

test('split publish longer', t => {
  t.plan(3)

  const length = 255
  const topic = 'test'
  // Minus two bytes for the topic length specifier
  const payloadLength = length - topic.length - 2

  const parser = mqtt.parser()
  const expected = {
    cmd: 'publish',
    retain: false,
    qos: 0,
    dup: false,
    length,
    topic,
    payload: Buffer.from('a'.repeat(payloadLength))
  }

  parser.on('packet', packet => {
    t.deepLooseEqual(packet, expected, 'expected packet')
  })

  t.equal(parser.parse(Buffer.from([
    48, 255, 1, // Header
    0, topic.length, // Topic length
    116, 101, 115, 116 // Topic (test)
  ])), 6, 'remaining bytes')

  t.equal(parser.parse(Buffer.from(Array(payloadLength).fill(97))),
    0, 'remaining bytes')
})

test('split length parse', t => {
  t.plan(4)

  const length = 255
  const topic = 'test'
  const payloadLength = length - topic.length - 2

  const parser = mqtt.parser()
  const expected = {
    cmd: 'publish',
    retain: false,
    qos: 0,
    dup: false,
    length,
    topic,
    payload: Buffer.from('a'.repeat(payloadLength))
  }

  parser.on('packet', packet => {
    t.deepLooseEqual(packet, expected, 'expected packet')
  })

  t.equal(parser.parse(Buffer.from([
    48, 255 // Header (partial length)
  ])), 1, 'remaining bytes')

  t.equal(parser.parse(Buffer.from([
    1, // Rest of header length
    0, topic.length, // Topic length
    116, 101, 115, 116 // Topic (test)
  ])), 6, 'remaining bytes')

  t.equal(parser.parse(Buffer.from(Array(payloadLength).fill(97))),
    0, 'remaining bytes')
})

testGenerateError('Invalid variable byte integer: 268435456', {
  cmd: 'publish',
  retain: false,
  qos: 0,
  dup: false,
  length: (268435455 + 1),
  topic: 'test',
  payload: Buffer.alloc(268435455 + 1 - 6)
}, {}, 'Length var byte integer over max allowed value throws error')

testGenerateError('Invalid subscriptionIdentifier: 268435456', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 27,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: false,
    subscriptionIdentifier: 268435456
  }
}, { protocolVersion: 5 }, 'MQTT 5.0 var byte integer >24 bits throws error')

testParseGenerate('puback', {
  cmd: 'puback',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  messageId: 2
}, Buffer.from([
  64, 2, // Header
  0, 2 // Message ID
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for puback packet', Buffer.from([
  65, 2, // Header
  0, 2 // Message ID
]))

testParseGenerate('puback without reason and no MQTT 5 properties', {
  cmd: 'puback',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  messageId: 2,
  reasonCode: 0
}, Buffer.from([
  64, 2, // Header
  0, 2 // Message ID
]), { protocolVersion: 5 })

testParseGenerate('puback with reason and no MQTT 5 properties', {
  cmd: 'puback',
  retain: false,
  qos: 0,
  dup: false,
  length: 4,
  messageId: 2,
  reasonCode: 16
}, Buffer.from([
  64, 4, // Header
  0, 2, // Message ID
  16, // reason code
  0 // no user properties
]), { protocolVersion: 5 })

testParseGenerate('puback MQTT 5 properties', {
  cmd: 'puback',
  retain: false,
  qos: 0,
  dup: false,
  length: 24,
  messageId: 2,
  reasonCode: 16,
  properties: {
    reasonString: 'test',
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  64, 24, // Header
  0, 2, // Message ID
  16, // reason code
  20, // properties length
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116 // userProperties
]), { protocolVersion: 5 })

testParseError('Invalid puback reason code', Buffer.from([
  64, 4, // Header
  0, 2, // Message ID
  0x11, // reason code
  0 // properties length
]), { protocolVersion: 5 })

testParseGenerate('pubrec', {
  cmd: 'pubrec',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  messageId: 2
}, Buffer.from([
  80, 2, // Header
  0, 2 // Message ID
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for pubrec packet', Buffer.from([
  81, 2, // Header
  0, 2 // Message ID
]))

testParseGenerate('pubrec MQTT 5 properties', {
  cmd: 'pubrec',
  retain: false,
  qos: 0,
  dup: false,
  length: 24,
  messageId: 2,
  reasonCode: 16,
  properties: {
    reasonString: 'test',
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  80, 24, // Header
  0, 2, // Message ID
  16, // reason code
  20, // properties length
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116 // userProperties
]), { protocolVersion: 5 })

testParseGenerate('pubrel', {
  cmd: 'pubrel',
  retain: false,
  qos: 1,
  dup: false,
  length: 2,
  messageId: 2
}, Buffer.from([
  98, 2, // Header
  0, 2 // Message ID
]))

testParseError('Invalid pubrel reason code', Buffer.from([
  98, 4, // Header
  0, 2, // Message ID
  0x11, // Reason code
  0 // Properties length
]), { protocolVersion: 5 })

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x2 for pubrel packet', Buffer.from([
  96, 2, // Header
  0, 2 // Message ID
]))

testParseGenerate('pubrel MQTT5 properties', {
  cmd: 'pubrel',
  retain: false,
  qos: 1,
  dup: false,
  length: 24,
  messageId: 2,
  reasonCode: 0x92,
  properties: {
    reasonString: 'test',
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  98, 24, // Header
  0, 2, // Message ID
  0x92, // reason code
  20, // properties length
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116 // userProperties
]), { protocolVersion: 5 })

testParseError('Invalid pubrel reason code', Buffer.from([
  98, 4, // Header
  0, 2, // Message ID
  16, // reason code
  0 // properties length
]), { protocolVersion: 5 })

testParseGenerate('pubcomp', {
  cmd: 'pubcomp',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  messageId: 2
}, Buffer.from([
  112, 2, // Header
  0, 2 // Message ID
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for pubcomp packet', Buffer.from([
  113, 2, // Header
  0, 2 // Message ID
]))

testParseGenerate('pubcomp MQTT 5 properties', {
  cmd: 'pubcomp',
  retain: false,
  qos: 0,
  dup: false,
  length: 24,
  messageId: 2,
  reasonCode: 0x92,
  properties: {
    reasonString: 'test',
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  112, 24, // Header
  0, 2, // Message ID
  0x92, // reason code
  20, // properties length
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116 // userProperties
]), { protocolVersion: 5 })

testParseError('Invalid pubcomp reason code', Buffer.from([
  112, 4, // Header
  0, 2, // Message ID
  16, // reason code
  0 // properties length
]), { protocolVersion: 5 })

testParseError('Invalid header flag bits, must be 0x2 for subscribe packet', Buffer.from([
  128, 9, // Header (subscribeqos=0length=9)
  0, 6, // Message ID (6)
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  0 // Qos (0)
]))

testParseGenerate('subscribe to one topic', {
  cmd: 'subscribe',
  retain: false,
  qos: 1,
  dup: false,
  length: 9,
  subscriptions: [
    {
      topic: 'test',
      qos: 0
    }
  ],
  messageId: 6
}, Buffer.from([
  130, 9, // Header (subscribeqos=1length=9)
  0, 6, // Message ID (6)
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  0 // Qos (0)
]))

testParseError('Invalid subscribe QoS, must be <= 2', Buffer.from([
  130, 9, // Header (subscribeqos=0length=9)
  0, 6, // Message ID (6)
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  3 // Qos
]))

testParseError('Invalid subscribe topic flag bits, bits 7-6 must be 0', Buffer.from([
  130, 10, // Header (subscribeqos=0length=9)
  0, 6, // Message ID (6)
  0, // Property length (0)
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  0x80 // Flags
]), { protocolVersion: 5 })

testParseError('Invalid retain handling, must be <= 2', Buffer.from([
  130, 10, // Header (subscribeqos=0length=9)
  0, 6, // Message ID (6)
  0, // Property length (0)
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  0x30 // Flags
]), { protocolVersion: 5 })

testParseError('Invalid subscribe topic flag bits, bits 7-2 must be 0', Buffer.from([
  130, 9, // Header (subscribeqos=0length=9)
  0, 6, // Message ID (6)
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  0x08 // Flags
]))

testParseGenerate('subscribe to one topic by MQTT 5', {
  cmd: 'subscribe',
  retain: false,
  qos: 1,
  dup: false,
  length: 26,
  subscriptions: [
    {
      topic: 'test',
      qos: 0,
      nl: false,
      rap: true,
      rh: 1
    }
  ],
  messageId: 6,
  properties: {
    subscriptionIdentifier: 145,
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  130, 26, // Header (subscribeqos=1length=9)
  0, 6, // Message ID (6)
  16, // properties length
  11, 145, 1, // subscriptionIdentifier
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  24 // settings(qos: 0, noLocal: false, Retain as Published: true, retain handling: 1)
]), { protocolVersion: 5 })

testParseGenerate('subscribe to three topics', {
  cmd: 'subscribe',
  retain: false,
  qos: 1,
  dup: false,
  length: 23,
  subscriptions: [
    {
      topic: 'test',
      qos: 0
    }, {
      topic: 'uest',
      qos: 1
    }, {
      topic: 'tfst',
      qos: 2
    }
  ],
  messageId: 6
}, Buffer.from([
  130, 23, // Header (publishqos=1length=9)
  0, 6, // Message ID (6)
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  0, // Qos (0)
  0, 4, // Topic length
  117, 101, 115, 116, // Topic (uest)
  1, // Qos (1)
  0, 4, // Topic length
  116, 102, 115, 116, // Topic (tfst)
  2 // Qos (2)
]))

testParseGenerate('subscribe to 3 topics by MQTT 5', {
  cmd: 'subscribe',
  retain: false,
  qos: 1,
  dup: false,
  length: 40,
  subscriptions: [
    {
      topic: 'test',
      qos: 0,
      nl: false,
      rap: true,
      rh: 1
    },
    {
      topic: 'uest',
      qos: 1,
      nl: false,
      rap: false,
      rh: 0
    }, {
      topic: 'tfst',
      qos: 2,
      nl: true,
      rap: false,
      rh: 0
    }
  ],
  messageId: 6,
  properties: {
    subscriptionIdentifier: 145,
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  130, 40, // Header (subscribeqos=1length=9)
  0, 6, // Message ID (6)
  16, // properties length
  11, 145, 1, // subscriptionIdentifier
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  0, 4, // Topic length,
  116, 101, 115, 116, // Topic (test)
  24, // settings(qos: 0, noLocal: false, Retain as Published: true, retain handling: 1)
  0, 4, // Topic length
  117, 101, 115, 116, // Topic (uest)
  1, // Qos (1)
  0, 4, // Topic length
  116, 102, 115, 116, // Topic (tfst)
  6 // Qos (2), No Local: true
]), { protocolVersion: 5 })

testParseGenerate('suback', {
  cmd: 'suback',
  retain: false,
  qos: 0,
  dup: false,
  length: 5,
  granted: [0, 1, 2],
  messageId: 6
}, Buffer.from([
  144, 5, // Header
  0, 6, // Message ID
  0, 1, 2
]))

testParseGenerate('suback', {
  cmd: 'suback',
  retain: false,
  qos: 0,
  dup: false,
  length: 7,
  granted: [0, 1, 2, 128],
  messageId: 6
}, Buffer.from([
  144, 7, // Header
  0, 6, // Message ID
  0, // Property length
  0, 1, 2, 128 // Granted qos (0, 1, 2) and a rejected being 0x80
]), { protocolVersion: 5 })

testParseError('Invalid suback QoS, must be 0, 1, 2 or 128', Buffer.from([
  144, 6, // Header
  0, 6, // Message ID
  0, 1, 2, 3 // Granted qos (0, 1, 2)
]))

testParseError('Invalid suback code', Buffer.from([
  144, 6, // Header
  0, 6, // Message ID
  0, 1, 2, 0x79 // Granted qos (0, 1, 2) and an invalid code
]), { protocolVersion: 5 })

testParseGenerate('suback MQTT 5', {
  cmd: 'suback',
  retain: false,
  qos: 0,
  dup: false,
  length: 27,
  granted: [0, 1, 2, 128],
  messageId: 6,
  properties: {
    reasonString: 'test',
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  144, 27, // Header
  0, 6, // Message ID
  20, // properties length
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  0, 1, 2, 128 // Granted qos (0, 1, 2) and a rejected being 0x80
]), { protocolVersion: 5 })

testParseGenerate('unsubscribe', {
  cmd: 'unsubscribe',
  retain: false,
  qos: 1,
  dup: false,
  length: 14,
  unsubscriptions: [
    'tfst',
    'test'
  ],
  messageId: 7
}, Buffer.from([
  162, 14,
  0, 7, // Message ID (7)
  0, 4, // Topic length
  116, 102, 115, 116, // Topic (tfst)
  0, 4, // Topic length,
  116, 101, 115, 116 // Topic (test)
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x2 for unsubscribe packet', Buffer.from([
  160, 14,
  0, 7, // Message ID (7)
  0, 4, // Topic length
  116, 102, 115, 116, // Topic (tfst)
  0, 4, // Topic length,
  116, 101, 115, 116 // Topic (test)
]))

testGenerateError('Invalid unsubscriptions', {
  cmd: 'unsubscribe',
  retain: false,
  qos: 1,
  dup: true,
  length: 5,
  unsubscriptions: 5,
  messageId: 7
}, {}, 'unsubscribe with unsubscriptions not an array')

testGenerateError('Invalid unsubscriptions', {
  cmd: 'unsubscribe',
  retain: false,
  qos: 1,
  dup: true,
  length: 5,
  unsubscriptions: [1, 2],
  messageId: 7
}, {}, 'unsubscribe with unsubscriptions as an object')

testParseGenerate('unsubscribe MQTT 5', {
  cmd: 'unsubscribe',
  retain: false,
  qos: 1,
  dup: false,
  length: 28,
  unsubscriptions: [
    'tfst',
    'test'
  ],
  messageId: 7,
  properties: {
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  162, 28,
  0, 7, // Message ID (7)
  13, // properties length
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  0, 4, // Topic length
  116, 102, 115, 116, // Topic (tfst)
  0, 4, // Topic length,
  116, 101, 115, 116 // Topic (test)
]), { protocolVersion: 5 })

testParseGenerate('unsuback', {
  cmd: 'unsuback',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  messageId: 8
}, Buffer.from([
  176, 2, // Header
  0, 8 // Message ID
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for unsuback packet', Buffer.from([
  177, 2, // Header
  0, 8 // Message ID
]))

testParseGenerate('unsuback MQTT 5', {
  cmd: 'unsuback',
  retain: false,
  qos: 0,
  dup: false,
  length: 25,
  messageId: 8,
  properties: {
    reasonString: 'test',
    userProperties: {
      test: 'test'
    }
  },
  granted: [0, 128]
}, Buffer.from([
  176, 25, // Header
  0, 8, // Message ID
  20, // properties length
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  0, 128 // success and error
]), { protocolVersion: 5 })

testParseError('Invalid unsuback code', Buffer.from([
  176, 4, // Header
  0, 8, // Message ID
  0, // properties length
  0x84 // reason codes
]), { protocolVersion: 5 })

testParseGenerate('pingreq', {
  cmd: 'pingreq',
  retain: false,
  qos: 0,
  dup: false,
  length: 0
}, Buffer.from([
  192, 0 // Header
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for pingreq packet', Buffer.from([
  193, 0 // Header
]))

testParseGenerate('pingresp', {
  cmd: 'pingresp',
  retain: false,
  qos: 0,
  dup: false,
  length: 0
}, Buffer.from([
  208, 0 // Header
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for pingresp packet', Buffer.from([
  209, 0 // Header
]))

testParseGenerate('disconnect', {
  cmd: 'disconnect',
  retain: false,
  qos: 0,
  dup: false,
  length: 0
}, Buffer.from([
  224, 0 // Header
]))

// Where a flag bit is marked as “Reserved” in Table 2.2 - Flag Bits, it is reserved for future use and MUST be set to the value listed in that table [MQTT-2.2.2-1]. If invalid flags are received, the receiver MUST close the Network Connection [MQTT-2.2.2-2]
testParseError('Invalid header flag bits, must be 0x0 for disconnect packet', Buffer.from([
  225, 0 // Header
]))

testParseGenerate('disconnect MQTT 5', {
  cmd: 'disconnect',
  retain: false,
  qos: 0,
  dup: false,
  length: 34,
  reasonCode: 0,
  properties: {
    sessionExpiryInterval: 145,
    reasonString: 'test',
    userProperties: {
      test: 'test'
    },
    serverReference: 'test'
  }
}, Buffer.from([
  224, 34, // Header
  0, // reason code
  32, // properties length
  17, 0, 0, 0, 145, // sessionExpiryInterval
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  28, 0, 4, 116, 101, 115, 116// serverReference
]), { protocolVersion: 5 })

testParseGenerate('disconnect MQTT 5 with no properties', {
  cmd: 'disconnect',
  retain: false,
  qos: 0,
  dup: false,
  length: 2,
  reasonCode: 0
}, Buffer.from([
  224, 2, // Fixed Header (DISCONNECT, Remaining Length)
  0, // Reason Code (Normal Disconnection)
  0 // Property Length (0 => No Properties)
]), { protocolVersion: 5 })

testParseError('Invalid disconnect reason code', Buffer.from([
  224, 2, // Fixed Header (DISCONNECT, Remaining Length)
  0x05, // Reason Code (Normal Disconnection)
  0 // Property Length (0 => No Properties)
]), { protocolVersion: 5 })

testParseGenerate('auth MQTT 5', {
  cmd: 'auth',
  retain: false,
  qos: 0,
  dup: false,
  length: 36,
  reasonCode: 0,
  properties: {
    authenticationMethod: 'test',
    authenticationData: Buffer.from([0, 1, 2, 3]),
    reasonString: 'test',
    userProperties: {
      test: 'test'
    }
  }
}, Buffer.from([
  240, 36, // Header
  0, // reason code
  34, // properties length
  21, 0, 4, 116, 101, 115, 116, // auth method
  22, 0, 4, 0, 1, 2, 3, // auth data
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116 // userProperties
]), { protocolVersion: 5 })

testParseError('Invalid auth reason code', Buffer.from([
  240, 2, // Fixed Header (DISCONNECT, Remaining Length)
  0x17, // Reason Code
  0 // Property Length (0 => No Properties)
]), { protocolVersion: 5 })

testParseOnly('minimal Success AUTH with reason code and property length omitted', {
  cmd: 'auth',
  retain: false,
  qos: 0,
  dup: false,
  length: 0,
  topic: null,
  payload: null,
  reasonCode: 0
}, Buffer.from([
  240, 0 // Fixed Header (AUTH, Remaining Length 0)
]), { protocolVersion: 5 })

testGenerateError('Invalid protocolId', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 42,
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: 'password'
})

testGenerateError('Invalid protocol version', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 1,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: 'password'
})

testGenerateError('clientId must be supplied before 3.1.1', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  username: 'username',
  password: 'password'
})

testGenerateError('clientId must be given if cleanSession set to 0', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQTT',
  protocolVersion: 4,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: false,
  keepalive: 30,
  username: 'username',
  password: 'password'
})

testGenerateError('Invalid keepalive', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 'hello',
  clientId: 'test',
  username: 'username',
  password: 'password'
})

testGenerateError('Invalid keepalive', {
  cmd: 'connect',
  keepalive: 3.1416
})

testGenerateError('Invalid will', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: 42,
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: 'password'
})

testGenerateError('Invalid will topic', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: 'password'
})

testGenerateError('Invalid will payload', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 42
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: 'password'
})

testGenerateError('Invalid username', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 42,
  password: 'password'
})

testGenerateError('Invalid password', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  username: 'username',
  password: 42
})

testGenerateError('Username is required to use password', {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 54,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  will: {
    retain: true,
    qos: 2,
    topic: 'topic',
    payload: 'payload'
  },
  clean: true,
  keepalive: 30,
  clientId: 'test',
  password: 'password'
})

testGenerateError('Invalid messageExpiryInterval: -4321', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 60,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: true,
    messageExpiryInterval: -4321,
    topicAlias: 100,
    responseTopic: 'topic',
    correlationData: Buffer.from([1, 2, 3, 4]),
    userProperties: {
      test: 'test'
    },
    subscriptionIdentifier: 120,
    contentType: 'test'
  }
}, { protocolVersion: 5 })

testGenerateError('Invalid topicAlias: -100', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 60,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: true,
    messageExpiryInterval: 4321,
    topicAlias: -100,
    responseTopic: 'topic',
    correlationData: Buffer.from([1, 2, 3, 4]),
    userProperties: {
      test: 'test'
    },
    subscriptionIdentifier: 120,
    contentType: 'test'
  }
}, { protocolVersion: 5 })

testGenerateError('Invalid subscriptionIdentifier: -120', {
  cmd: 'publish',
  retain: true,
  qos: 2,
  dup: true,
  length: 60,
  topic: 'test',
  payload: Buffer.from('test'),
  messageId: 10,
  properties: {
    payloadFormatIndicator: true,
    messageExpiryInterval: 4321,
    topicAlias: 100,
    responseTopic: 'topic',
    correlationData: Buffer.from([1, 2, 3, 4]),
    userProperties: {
      test: 'test'
    },
    subscriptionIdentifier: -120,
    contentType: 'test'
  }
}, { protocolVersion: 5 })

test('support cork', t => {
  t.plan(9)

  const dest = WS()

  dest._write = (chunk, enc, cb) => {
    t.pass('_write called')
    cb()
  }

  mqtt.writeToStream({
    cmd: 'connect',
    retain: false,
    qos: 0,
    dup: false,
    length: 18,
    protocolId: 'MQIsdp',
    protocolVersion: 3,
    clean: false,
    keepalive: 30,
    clientId: 'test'
  }, dest)

  dest.end()
})

// The following test case was designed after experiencing errors
// when trying to connect with tls on a non tls mqtt port
// the specific behaviour is:
// - first byte suggests this is a connect message
// - second byte suggests message length to be smaller than buffer length
//   thus payload processing starts
// - the first two bytes suggest a protocol identifier string length
//   that leads the parser pointer close to the end of the buffer
// - when trying to read further connect flags the buffer produces
//   a "out of range" Error
//
testParseError('Packet too short', Buffer.from([
  16, 9,
  0, 6,
  77, 81, 73, 115, 100, 112,
  3
]))

// CONNECT Packets that show other protocol IDs than
// the valid values MQTT and MQIsdp should cause an error
// those packets are a hint that this is not a mqtt connection
testParseError('Invalid protocolId', Buffer.from([
  16, 18,
  0, 6,
  65, 65, 65, 65, 65, 65, // AAAAAA
  3, // Protocol version
  0, // Connect flags
  0, 10, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116 // Client ID
]))

// CONNECT Packets that contain an unsupported protocol version
// Flag (i.e. not `3` or `4` or '5') should cause an error
testParseError('Invalid protocol version', Buffer.from([
  16, 18,
  0, 6,
  77, 81, 73, 115, 100, 112, // Protocol ID
  1, // Protocol version
  0, // Connect flags
  0, 10, // Keepalive
  0, 4, // Client ID length
  116, 101, 115, 116 // Client ID
]))

// When a packet contains a string in the variable header and the
// given string length of this exceeds the overall length of the packet that
// was specified in the fixed header, parsing must fail.
// this case simulates this behavior with the protocol ID string of the
// CONNECT packet. The fixed header suggests a remaining length of 8 bytes
// which would be exceeded by the string length of 15
// in this case, a protocol ID parse error is expected
testParseError('Cannot parse protocolId', Buffer.from([
  16, 8, // Fixed header
  0, 15, // string length 15 --> 15 > 8 --> error!
  77, 81, 73, 115, 100, 112,
  77, 81, 73, 115, 100, 112,
  77, 81, 73, 115, 100, 112,
  77, 81, 73, 115, 100, 112,
  77, 81, 73, 115, 100, 112,
  77, 81, 73, 115, 100, 112,
  77, 81, 73, 115, 100, 112,
  77, 81, 73, 115, 100, 112
]))

testParseError('Unknown property', Buffer.from([
  61, 60, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  0, 10, // Message ID
  47, // properties length
  126, 1, // unknown property
  2, 0, 0, 16, 225, // message expiry interval
  35, 0, 100, // topicAlias
  8, 0, 5, 116, 111, 112, 105, 99, // response topic
  9, 0, 4, 1, 2, 3, 4, // correlationData
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116, // userProperties
  11, 120, // subscriptionIdentifier
  3, 0, 4, 116, 101, 115, 116, // content type
  116, 101, 115, 116 // Payload (test)
]), { protocolVersion: 5 })

testParseError('Not supported auth packet for this version MQTT', Buffer.from([
  240, 36, // Header
  0, // reason code
  34, // properties length
  21, 0, 4, 116, 101, 115, 116, // auth method
  22, 0, 4, 0, 1, 2, 3, // auth data
  31, 0, 4, 116, 101, 115, 116, // reasonString
  38, 0, 4, 116, 101, 115, 116, 0, 4, 116, 101, 115, 116 // userProperties
]))

// When a Subscribe packet contains a topic_filter and the given
// length is topic_filter.length + 1 then the last byte (requested QoS) is interpreted as topic_filter
// reading the requested_qos at the end causes 'Index out of range' read
testParseError('Malformed Subscribe Payload', Buffer.from([
  130, 14, // subscribe header and remaining length
  0, 123, // packet ID
  0, 10, // topic filter length
  104, 105, 106, 107, 108, 47, 109, 110, 111, // topic filter with length of 9 bytes
  0 // requested QoS
]))

test('Cannot parse property code type', t => {
  // The trailing DISCONNECT used to be `224, 2, 0, 32`, which now trips the
  // Property Length boundary check instead: remaining length 2 leaves no byte
  // for the property the length declares. `224, 3, 0, 1, 0` keeps the property
  // block inside the packet so the property code 0 is what fails, as intended.
  const packets = Buffer.from([
    16, 16, 0, 4, 77, 81, 84, 84, 5, 2, 0, 60, 3, 33, 0, 20, 0, 0, 98, 2, 211, 1, 224, 3, 0, 1, 0
  ])

  t.plan(3)

  const parser = mqtt.parser()

  parser.on('error', err => {
    t.equal(err.message, 'Cannot parse property code type', 'expected error message')
    t.end()
  })

  parser.on('packet', (packet) => {
    t.pass('Packet parsed')
  })

  parser.parse(packets)
})

testWriteToStreamError('Invalid command', {
  cmd: 'invalid'
})

testWriteToStreamError('Invalid protocolId', {
  cmd: 'connect',
  protocolId: {}
})

test('userProperties null prototype', t => {
  t.plan(3)

  const packet = mqtt.generate({
    cmd: 'connect',
    retain: false,
    qos: 0,
    dup: false,
    length: 125,
    protocolId: 'MQTT',
    protocolVersion: 5,
    will: {
      retain: true,
      qos: 2,
      properties: {
        willDelayInterval: 1234,
        payloadFormatIndicator: false,
        messageExpiryInterval: 4321,
        contentType: 'test',
        responseTopic: 'topic',
        correlationData: Buffer.from([1, 2, 3, 4]),
        userProperties: {
          test: 'test'
        }
      },
      topic: 'topic',
      payload: Buffer.from([4, 3, 2, 1])
    },
    clean: true,
    keepalive: 30,
    properties: {
      sessionExpiryInterval: 1234,
      receiveMaximum: 432,
      maximumPacketSize: 100,
      topicAliasMaximum: 456,
      requestResponseInformation: true,
      requestProblemInformation: true,
      userProperties: {
        test: 'test'
      },
      authenticationMethod: 'test',
      authenticationData: Buffer.from([1, 2, 3, 4])
    },
    clientId: 'test'
  })

  const parser = mqtt.parser()

  parser.on('packet', packet => {
    t.equal(packet.cmd, 'connect')
    t.equal(Object.getPrototypeOf(packet.properties.userProperties), null)
    t.equal(Object.getPrototypeOf(packet.will.properties.userProperties), null)
  })

  parser.parse(packet)
})

test('stops parsing after first error', t => {
  t.plan(4)

  const parser = mqtt.parser()

  let packetCount = 0
  let errorCount = 0
  let expectedPackets = 1
  let expectedErrors = 1

  parser.on('packet', packet => {
    t.ok(++packetCount <= expectedPackets, `expected <= ${expectedPackets} packets`)
  })

  parser.on('error', erroneous => {
    t.ok(++errorCount <= expectedErrors, `expected <= ${expectedErrors} errors`)
  })

  parser.parse(Buffer.from([
    // First, a valid connect packet:

    16, 12, // Header
    0, 4, // Protocol ID length
    77, 81, 84, 84, // Protocol ID
    4, // Protocol version
    2, // Connect flags
    0, 30, // Keepalive
    0, 0, // Client ID length

    // Then an invalid subscribe packet:

    128, 9, // Header (subscribeqos=0length=9)
    0, 6, // Message ID (6)
    0, 4, // Topic length,
    116, 101, 115, 116, // Topic (test)
    0, // Qos (0)

    // And another invalid subscribe packet:

    128, 9, // Header (subscribeqos=0length=9)
    0, 6, // Message ID (6)
    0, 4, // Topic length,
    116, 101, 115, 116, // Topic (test)
    0, // Qos (0)

    // Finally, a valid disconnect packet:

    224, 0 // Header
  ]))

  // Calling parse again clears the error and continues parsing
  packetCount = 0
  errorCount = 0
  expectedPackets = 2
  expectedErrors = 0

  parser.parse(Buffer.from([
    // Connect:

    16, 12, // Header
    0, 4, // Protocol ID length
    77, 81, 84, 84, // Protocol ID
    4, // Protocol version
    2, // Connect flags
    0, 30, // Keepalive
    0, 0, // Client ID length

    // Disconnect:

    224, 0 // Header
  ]))
})

test('undefined properties', t => {
  t.plan(2)

  const packet = mqtt.generate({
    cmd: 'connect',
    retain: false,
    qos: 0,
    dup: false,
    length: 125,
    protocolId: 'MQTT',
    protocolVersion: 5,
    will: {
      retain: true,
      qos: 2,
      properties: {
        willDelayInterval: 1234,
        payloadFormatIndicator: false,
        messageExpiryInterval: 4321,
        contentType: 'test',
        responseTopic: 'topic',
        correlationData: Buffer.from([1, 2, 3, 4]),
        userProperties: {
          test: 'test'
        }
      },
      topic: 'topic',
      payload: Buffer.from([4, 3, 2, 1])
    },
    clean: true,
    keepalive: 30,
    properties: {
      sessionExpiryInterval: 1234,
      receiveMaximum: 432,
      maximumPacketSize: 100,
      topicAliasMaximum: 456,
      requestResponseInformation: true,
      requestProblemInformation: true,
      correlationData: undefined,
      userProperties: {
        test: 'test'
      },
      authenticationMethod: 'test',
      authenticationData: Buffer.from([1, 2, 3, 4])
    },
    clientId: 'test'
  })

  const parser = mqtt.parser()

  parser.on('packet', packet => {
    t.equal(packet.cmd, 'connect')
    t.equal(Object.hasOwn(packet.properties, 'correlationData'), false)
  })

  parser.parse(packet)
})

testGenerateErrorMultipleCmds([
  'publish',
  'puback',
  'pubrec',
  'pubrel',
  'subscribe',
  'suback',
  'unsubscribe',
  'unsuback'
], 'Invalid messageId', {
  qos: 1, // required for publish
  topic: 'test', // required for publish
  messageId: 'a'
}, {})
