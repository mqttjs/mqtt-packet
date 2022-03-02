const pino = require('pino')
const logger = pino({
  name: 'mqtt-packet',
  transport: {
    target: 'pino-pretty'
  }
})
module.exports = logger
