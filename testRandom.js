
var mqtt    = require('./')
  , crypto  = require('crypto')
  , max     = 1E5
  , i
  , start   = Date.now() / 1000
  , time
  , errors  = 0
  , packets = 0
  , randomPacket
  , firstBytes = [
    16*1, // CONNECT
    16*2, // CONNACK
    16*3, // PUBLISH, QoS: 0, No Retain, No Dup
    16*3 + 1, // PUBLISH, QoS: 0, Retain, No Dup
    16*3 + 8, // PUBLISH, QoS: 0, No Retain, Dup
    16*3 + 1 + 8, // PUBLISH, QoS: 0, Retain, Dup
    16*3 + 2, // PUBLISH, QoS: 1, No Retain, No Dup
    16*3 + + 1, // PUBLISH, QoS: 1, Retain, No Dup
    16*3 + 2 + 8, // PUBLISH, QoS: 1, No Retain, Dup
    16*3 + 2 + 1 + 8, // PUBLISH, QoS: 1, Retain, Dup
    16*3 + 4, // PUBLISH, QoS: 2, No Retain, No Dup
    16*3 + 4 + 1, // PUBLISH, QoS: 2, Retain, No Dup
    16*3 + 4 + 8, // PUBLISH, QoS: 2, No Retain, Dup
    16*3 + 4 + 1 + 8, // PUBLISH, QoS: 2, Retain, Dup
    16*4, // PUBACK
    16*5, // PUBREC
    16*6, // PUBREL
    16*7, // PUBCOMP
    16*8, // SUBSCRIBE  
    16*9, // SUBACK
    16*10, // UNSUBSCRIBE
    16*11, // UNSUBACK
    16*12, // PINGREQ
    16*13, // PINGRESP
    16*14, // DISCONNECT
    16*15  // RESERVED
  ]

function doParse () {

  var parser  = mqtt.parser();

  parser.on('error', onError);
  parser.on('packet', onPacket);
  randomPacket = crypto.randomBytes(Math.floor(Math.random() * 512));

  // Increase probability to have a valid first byte in order to at least
  // enter the parser
  if(Math.random() > 0.2 && randomPacket.length > 0) {

    randomPacket.writeUInt8(firstBytes[Math.floor(Math.random()*firstBytes.length)],0);
  }

  parser.parse(randomPacket);
}

try {

  for (i = 0; i < max; i++) {
    doParse();
  }
}
catch(e) {

  console.log('Exception occured at packet');
  console.log(randomPacket);
  console.log(e.message);
  console.log(e.stack);
}

function onError () {
  errors++;
}

function onPacket() {
  packets++;
}

time = Date.now() / 1000 - start;
console.log('Total time', Math.round(time * 100) / 100);
console.log('Valid Packets', packets);
console.log('Errors', errors);
console.log('Valid Packets + Errors', packets + errors);

delta = max - packets - errors;

if(delta > 0) {

  console.log(delta + ' packets too short to generate parse results');
}
else {

  console.log(-1 * delta + ' more packets parsed then generated');
}
