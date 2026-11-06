'use strict';
const net = require('node:net');
const encodeVarint = number => {
  const bytes = [];
  let n = number >>> 0;
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; bytes.push(b); } while (n);
  return Buffer.from(bytes);
};
const decodeVarint = (buffer, start = 0) => {
  let result = 0;
  for (let i = 0; i < 5; i++) {
    if (start + i >= buffer.length) return null;
    const b = buffer[start + i];
    result |= (b & 0x7f) << (i * 7);
    if (!(b & 0x80)) return { value: result >>> 0, length: i + 1 };
  }
  throw Error('Varint inválido');
};
const packet = payload => Buffer.concat([encodeVarint(payload.length), payload]);
const string = value => {
  const encoded = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeVarint(encoded.length), encoded]);
};
const isSafeHost = host => /^[a-zA-Z0-9.-]{1,253}$/.test(host) && !host.startsWith('-');
async function minecraftStatus(host, port = 25565, timeout = 3000) {
  if (!isSafeHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw Error('Servidor Minecraft inválido');
  return new Promise((resolve, reject) => {
    let done = false;
    let incoming = Buffer.alloc(0);
    const client = net.createConnection({ host, port });
    const finish = (error, result) => {
      if (done) return;
      done = true;
      client.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    client.setTimeout(timeout, () => finish(Error('Tempo de conexão esgotado')));
    client.once('error', e => finish(e));
    client.once('connect', () => {
      const handshake = Buffer.concat([
        encodeVarint(0), encodeVarint(765), string(host),
        Buffer.from([port >> 8, port & 255]), encodeVarint(1)
      ]);
      client.write(Buffer.concat([packet(handshake), packet(encodeVarint(0))]));
    });
    client.on('data', chunk => {
      incoming = Buffer.concat([incoming, chunk]);
      if (incoming.length > 1024 * 1024) return finish(Error('Resposta demasiado grande'));
      try {
        const size = decodeVarint(incoming);
        if (!size || incoming.length < size.length + size.value) return;
        const payload = incoming.subarray(size.length, size.length + size.value);
        const id = decodeVarint(payload);
        if (!id || id.value !== 0) return finish(Error('Resposta Minecraft inválida'));
        const jsonSize = decodeVarint(payload, id.length);
        if (!jsonSize || jsonSize.value > 1024 * 1024) return finish(Error('Status inválido'));
        const start = id.length + jsonSize.length;
        if (start + jsonSize.value > payload.length) return finish(Error('Status incompleto'));
        const status = JSON.parse(payload.subarray(start, start + jsonSize.value).toString('utf8'));
        finish(null, {online: true, version: status.version?.name || null, players: status.players?.online ?? 0,
          maxPlayers: status.players?.max ?? 0, description: status.description || null});
      } catch (e) { finish(e); }
    });
    client.once('end', () => { if (!done) finish(Error('Servidor encerrou a conexão sem responder')); });
  });
}
module.exports = {minecraftStatus, encodeVarint, decodeVarint};
