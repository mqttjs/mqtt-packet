
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
