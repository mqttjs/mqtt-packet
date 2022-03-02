const mqtt = require('./')
const crypto = require('crypto')
const logger = require('pino')()

const max = 1E5
const start = Date.now() / 1000
let errors = 0
let packets = 0
let randomPacket
const firstBytes = [
  16 * 1, // CONNECT
  16 * 2, // CONNACK
  16 * 3, // PUBLISH, QoS: 0, No Retain, No Dup
  16 * 3 + 1, // PUBLISH, QoS: 0, Retain, No Dup
  16 * 3 + 8, // PUBLISH, QoS: 0, No Retain, Dup
  16 * 3 + 1 + 8, // PUBLISH, QoS: 0, Retain, Dup
  16 * 3 + 2, // PUBLISH, QoS: 1, No Retain, No Dup
  16 * 3 + 2 + 1, // PUBLISH, QoS: 1, Retain, No Dup
  16 * 3 + 2 + 8, // PUBLISH, QoS: 1, No Retain, Dup
  16 * 3 + 2 + 1 + 8, // PUBLISH, QoS: 1, Retain, Dup
  16 * 3 + 4, // PUBLISH, QoS: 2, No Retain, No Dup
  16 * 3 + 4 + 1, // PUBLISH, QoS: 2, Retain, No Dup
  16 * 3 + 4 + 8, // PUBLISH, QoS: 2, No Retain, Dup
  16 * 3 + 4 + 1 + 8, // PUBLISH, QoS: 2, Retain, Dup
  16 * 4, // PUBACK
  16 * 5, // PUBREC
  16 * 6, // PUBREL
  16 * 7, // PUBCOMP
  16 * 8, // SUBSCRIBE
  16 * 9, // SUBACK
  16 * 10, // UNSUBSCRIBE
  16 * 11, // UNSUBACK
  16 * 12, // PINGREQ
  16 * 13, // PINGRESP
  16 * 14, // DISCONNECT
  16 * 15 // RESERVED
]

function doParse () {
  const parser = mqtt.parser()

  parser.on('error', onError)
  parser.on('packet', onPacket)
  randomPacket = crypto.randomBytes(Math.floor(Math.random() * 512))

  // Increase probability to have a valid first byte in order to at least
  // enter the parser
  if (Math.random() > 0.2 && randomPacket.length > 0) randomPacket.writeUInt8(firstBytes[Math.floor(Math.random() * firstBytes.length)], 0)
  parser.parse(randomPacket)
}

try {
  logger.info('Starting benchmark')
  for (let i = 0; i < max; i++) {
    doParse()
  }
} catch (e) {
  logger.info('Exception occurred at packet')
  logger.info(randomPacket)
  logger.info(e.message)
  logger.info(e.stack)
}

function onError () {
  errors++
}

function onPacket () {
  packets++
}

const delta = Math.abs(max - packets - errors)
const time = Date.now() / 1000 - start
logger.info('Benchmark complete')
logger.info('==========================')
logger.info('Sent packets:', max)
logger.info('Total time:', Math.round(time * 100) / 100, 'seconds', '\r\n')

logger.info('Valid packets:', packets)
logger.info('Erroneous packets:', errors)

if ((max - packets - errors) < 0) logger.info('Excess packets:', delta, '\r\n')
else logger.info('Missing packets:', delta, '\r\n')

logger.info('Total packets:', packets + errors)
logger.info('Total errors:', errors + delta)
logger.info('Error rate:', `${((errors + delta) / max * 100).toFixed(2)}%`)
logger.info('==========================')
