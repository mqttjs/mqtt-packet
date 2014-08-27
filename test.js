
var test = require('tape')
  , mqtt = require('./')

function testParse(name, expected, fixture, rest) {
  test(name, function(t) {
    t.plan(2)

    var parser = mqtt.parser()
      , rest

    console.log(fixture.length)

    parser.on('packet', function(packet) {
      t.deepEqual(packet, expected, 'expected packet')
    })

    t.equal(parser.parse(fixture), rest || 0, 'remaining bytes')
  })
}

testParse('minimal connect', {
      cmd: "connect"
    , retain: false
    , qos: 0
    , dup: false
    , length: 18
    , protocolId: "MQIsdp"
    , protocolVersion: 3
    , clean: false
    , keepalive: 30
    , clientId: "test"
  }, new Buffer([
    16, 18, // Header
    0, 6, // Protocol id length
    77, 81, 73, 115, 100, 112, // Protocol id
    3, // Protocol version
    0, // Connect flags
    0, 30, // Keepalive
    0, 4, //Client id length
    116, 101, 115, 116 // Client id
  ])
)

testParse('maximal connect', {
      cmd: "connect"
    , retain: false
    , qos: 0
    , dup: false
    , length: 54
    , protocolId: "MQIsdp"
    , protocolVersion: 3
    , will: {
        retain: true
      , qos: 2
      , topic: "topic"
      , payload: "payload"
      }
    , clean: true
    , keepalive: 30
    , clientId: "test"
    , username: "username"
    , password: "password"
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
 ])
)
