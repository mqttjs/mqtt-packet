
var test = require('tape')
  , mqtt = require('./')


function testParseGenerate(name, object, buffer, opts) {
  test(name + ' parse', function(t) {
    t.plan(2)

    var parser    = mqtt.parser(opts)
      , expected  = object
      , fixture   = buffer

    parser.on('packet', function(packet) {
      t.deepEqual(packet, expected, 'expected packet')
    })

    t.equal(parser.parse(fixture), 0, 'remaining bytes')
  })

  test(name + ' parseStream', function(t) {
    t.plan(1)

    var parser    = mqtt.parseStream(opts)
      , expected  = object
      , fixture   = buffer

    parser.on('data', function(packet) {
      console.log(packet)
      t.deepEqual(packet, expected, 'expected packet')
    })

    parser.end(fixture)
  })

  test(name + ' generate', function(t) {
    t.equal(mqtt.generate(object).toString('hex'), buffer.toString('hex'))
    t.end()
  })

  test(name + ' mirror', function(t) {
    t.plan(2)

    var parser    = mqtt.parser(opts)
      , expected  = object
      , fixture   = mqtt.generate(object)

    parser.on('packet', function(packet) {
      t.deepEqual(packet, expected, 'expected packet')
    })

    t.equal(parser.parse(fixture), 0, 'remaining bytes')
  })
}

function testError(expected, fixture) {
  test(expected, function(t) {
    t.plan(1)

    var parser = mqtt.parser()
      , rest

    parser.on('error', function(err) {
      t.equal(err.message, expected, 'expected error message')
    })

    parser.parse(fixture)
  })
}

testParseGenerate('minimal connect', {
    cmd: 'connect'
  , retain: false
  , qos: 0
  , dup: false
  , length: 18
  , protocolId: 'MQIsdp'
  , protocolVersion: 3
  , clean: false
  , keepalive: 30
  , clientId: 'test'
}, new Buffer([
  16, 18, // Header
  0, 6, // Protocol id length
  77, 81, 73, 115, 100, 112, // Protocol id
  3, // Protocol version
  0, // Connect flags
  0, 30, // Keepalive
  0, 4, //Client id length
  116, 101, 115, 116 // Client id
]))


testParseGenerate('maximal connect', {
    cmd: 'connect'
  , retain: false
  , qos: 0
  , dup: false
  , length: 54
  , protocolId: 'MQIsdp'
  , protocolVersion: 3
  , will: {
      retain: true
    , qos: 2
    , topic: 'topic'
    , payload: 'payload'
    }
  , clean: true
  , keepalive: 30
  , clientId: 'test'
  , username: 'username'
  , password: 'password'
}, new Buffer([
  16, 54, // Header
  0, 6, // Protocol id length
  77, 81, 73, 115, 100, 112, // Protocol id
  3, // Protocol version
  246, // Connect flags
  0, 30, // Keepalive
  0, 4, // Client id length
  116, 101, 115, 116, // Client id
  0, 5, // will topic length
  116, 111, 112, 105, 99, // will topic
  0, 7, // will payload length
  112, 97, 121, 108, 111, 97, 100, // will payload
  0, 8, // username length
  117, 115, 101, 114, 110, 97, 109, 101, // username
  0, 8, // password length
  112, 97, 115, 115, 119, 111, 114, 100 //password
]))

testParseGenerate('binary username/password', {
    cmd: 'connect'
  , retain: false
  , qos: 0
  , dup: false
  , length: 28
  , protocolId: new Buffer([77, 81, 73, 115, 100, 112])
  , protocolVersion: 3
  , clean: false
  , keepalive: 30
  , clientId: new Buffer([116, 101, 115, 116])
  , username: new Buffer([12, 13, 14])
  , password: new Buffer([15, 16, 17])
}, new Buffer([
    16, 28, // Header
    0, 6, // Protocol id length
    77, 81, 73, 115, 100, 112, // Protocol id
    3, // Protocol version
    0x80 | 0x40, // Connect flags
    0, 30, // Keepalive
    0, 4, //Client id length
    116, 101, 115, 116, // Client id
    0, 3, // username length
    12, 13, 14, // username
    0, 3, // password length
    15, 16, 17 //password
]), {
  encoding: 'binary'
})

testError('cannot parse protocol id', new Buffer([
  16, 4,
  0, 6,
  77, 81
]))

testParseGenerate('connack with return code 0', {
    cmd: 'connack'
  , retain: false
  , qos: 0
  , dup: false
  , length: 2
  , returnCode: 0
}, new Buffer([
  32, 2, 0, 0
]))

testParseGenerate('connack with return code 5', {
    cmd: 'connack'
  , retain: false
  , qos: 0
  , dup: false
  , length: 2
  , returnCode: 5
}, new Buffer([
  32, 2, 0, 5
]))

testParseGenerate('minimal publish', {
    cmd: 'publish'
  , retain: false
  , qos: 0
  , dup: false
  , length: 10
  , topic: 'test'
  , payload: 'test'
}, new Buffer([
  48, 10, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic (test)
  116, 101, 115, 116 // Payload (test)
]))

;(function() {
  var buffer = new Buffer(2048)
  testParseGenerate('2KB publish packet', {
      cmd: 'publish'
    , retain: false
    , qos: 0
    , dup: false
    , length: 2054
    , topic: new Buffer('test')
    , payload: buffer
  }, Buffer.concat([new Buffer([
    48, 134, 16, // Header
    0, 4, // Topic length
    116, 101, 115, 116, // Topic (test)
  ]), buffer]), { encoding: 'binary' })
})()

;(function() {
  var buffer = new Buffer(2 * 1024 * 1024)
  testParseGenerate('2MB publish packet', {
      cmd: 'publish'
    , retain: false
    , qos: 0
    , dup: false
    , length: 6 + 2 * 1024 * 1024
    , topic: new Buffer('test')
    , payload: buffer
  }, Buffer.concat([new Buffer([
    48, 134, 128, 128, 1, // Header
    0, 4, // Topic length
    116, 101, 115, 116, // Topic (test)
  ]), buffer]), { encoding: 'binary' })
})()

testParseGenerate('maximal publish', {
    cmd:'publish'
  , retain: true
  , qos: 2
  , length: 12
  , dup: true
  , topic: 'test'
  , messageId: 10
  , payload: 'test'
}, new Buffer([
  61, 12, // Header
  0, 4, // Topic length
  116, 101, 115, 116, // Topic
  0, 10, // Message id
  116, 101, 115, 116 // Payload
]))

testParseGenerate('empty publish', {
    cmd: 'publish'
  , retain: false
  , qos: 0
  , dup: false
  , length: 6
  , topic: 'test'
  , payload: ''
}, new Buffer([
  48, 6, // Header
  0, 4, // Topic length
  116, 101, 115, 116 // Topic
  // Empty payload
]))


test('splitted publish parse', function(t) {
  t.plan(3)

  var parser = mqtt.parser()
    , rest
    , expected = {
          cmd: 'publish'
        , retain: false
        , qos: 0
        , dup: false
        , length: 10
        , topic: 'test'
        , payload: 'test'
      };

  parser.on('packet', function(packet) {
    t.deepEqual(packet, expected, 'expected packet')
  })

  t.equal(parser.parse(new Buffer([
    48, 10, // Header
    0, 4, // Topic length
    116, 101, 115, 116 // Topic (test)
  ])), 6, 'remaining bytes')


  t.equal(parser.parse(new Buffer([
    116, 101, 115, 116 // Payload (test)
  ])), 0, 'remaining bytes')
})

testParseGenerate('puback', {
    cmd: 'puback'
  , retain: false
  , qos: 0
  , dup: false
  , length: 2
  , messageId: 2
}, new Buffer([
  64, 2, // Header
  0, 2 // Message id
]))

testParseGenerate('pubrec', {
    cmd: 'pubrec'
  , retain: false
  , qos: 0
  , dup: false
  , length: 2
  , messageId: 2
}, new Buffer([
  80, 2, // Header
  0, 2 // Message id
]))

testParseGenerate('pubrel', {
    cmd: 'pubrel'
  , retain: false
  , qos: 1
  , dup: false
  , length: 2
  , messageId: 2
}, new Buffer([
  98, 2, // Header
  0, 2 // Message id
]))

testParseGenerate('pubcomp', {
    cmd: 'pubcomp'
  , retain: false
  , qos: 2
  , dup: false
  , length: 2
  , messageId: 2
}, new Buffer([
  116, 2, // Header
  0, 2 // Message id
]))

testParseGenerate('subscribe to one topic', {
    cmd: 'subscribe'
  , retain: false
  , qos: 1
  , dup: false
  , length: 9
  , subscriptions: [
      {
          topic: "test"
        , qos: 0
      }
    ]
  , messageId: 6
}, new Buffer([
  130, 9, // Header (publish, qos=1, length=9)
  0, 6, // message id (6)
  0, 4, // topic length,
  116, 101, 115, 116, // Topic (test)
  0 // qos (0)
]))

testParseGenerate('subscribe to three topics', {
    cmd: 'subscribe'
  , retain: false
  , qos: 1
  , dup: false
  , length: 23
  , subscriptions: [
      {
          topic: "test"
        , qos: 0
      },{
          topic: "uest"
        , qos: 1
      },{
          topic: "tfst"
        , qos: 2
      }
    ],
    messageId: 6
}, new Buffer([
  130, 23, // Header (publish, qos=1, length=9)
  0, 6, // message id (6)
  0, 4, // topic length,
  116, 101, 115, 116, // Topic (test)
  0, // qos (0)
  0, 4, // topic length
  117, 101, 115, 116, // Topic (uest)
  1, // qos (1)
  0, 4, // topic length
  116, 102, 115, 116, // Topic (tfst)
  2 // qos (2)
]))

testParseGenerate('suback', {
    cmd: 'suback'
  , retain: false
  , qos: 0
  , dup: false
  , length: 6
  , granted: [0, 1, 2, 128]
  , messageId: 6
}, new Buffer([
  144, 6, // Header
  0, 6, // Message id
  0, 1, 2, 128 // Granted qos (0, 1, 2) and a rejected being 0x80
]))

testParseGenerate('unsubscribe', {
    cmd: 'unsubscribe'
  , retain: false
  , qos: 1
  , dup: false
  , length: 14
  , unsubscriptions: [
        'tfst'
      , 'test'
    ],
    messageId: 7
}, new Buffer([
  162, 14,
  0, 7, // message id (7)
  0, 4, // topic length
  116, 102, 115, 116, // Topic (tfst)
  0, 4, // topic length,
  116, 101, 115, 116, // Topic (test)
]))

testParseGenerate('unsuback', {
    cmd: 'unsuback'
  , retain: false
  , qos: 0
  , dup: false
  , length: 2
  , messageId: 8
}, new Buffer([
  176, 2, // Header
  0, 8 // Message id
]))

testParseGenerate('pingreq', {
    cmd: 'pingreq'
  , retain: false
  , qos: 0
  , dup: false
  , length: 0
}, new Buffer([
  192, 0 // Header
]))

testParseGenerate('pingresp', {
    cmd: 'pingresp'
  , retain: false
  , qos: 0
  , dup: false
  , length: 0
}, new Buffer([
  208, 0 // Header
]))

testParseGenerate('disconnect', {
    cmd: 'disconnect'
  , retain: false
  , qos: 0
  , dup: false
  , length: 0
}, new Buffer([
  224, 0 // Header
]))
