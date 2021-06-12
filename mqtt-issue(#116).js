const mqtt = require('mqtt-packet');

function getPacket(data) {
    return new Promise((resolve, reject) => {
        try {
            const parser = mqtt.parser({ protocolVersion: 4 });
            parser.on('packet', async (packet) => {
                return resolve(packet);
            });

            parser.parse(data);
        } catch(err) {
            return reject(err);
        }
    });
}

async function start() {

    // Create puback package with message '46' and qos '1'
    const package = mqtt.generate({
        cmd: 'puback',
        messageId: 46,
        qos: 1,
    });

    // Expected output
    // {
        // cmd: 'puback',
        // retain: false,
        // qos: 1, => * HERE
        // dup: false,
        // length: 2,
        // topic: null,
        // payload: null,
        // messageId: 46
    // }

    // Actual output
    // {
        // cmd: 'puback',
        // retain: false,
        // qos: 0, => * HERE
        // dup: false,
        // length: 2,
        // topic: null,
        // payload: null,
        // messageId: 46
    // }

    const parsePackage = await getPacket(package);

    console.log('parsePackage: ');
    console.log(parsePackage);
}

start();
