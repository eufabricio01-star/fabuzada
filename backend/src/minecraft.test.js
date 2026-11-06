'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {minecraftStatus, encodeVarint, decodeVarint} = require('./minecraft');
test('codifica varints Minecraft', () => {
  for (const n of [0, 1, 127, 128, 255, 1024, 65535, 2097151]) {
    const result = decodeVarint(encodeVarint(n));
    assert.equal(result.value, n);
  }
});
test('consulta status de servidor Minecraft simulado', async () => {
  const mock = net.createServer(socket => {
    socket.once('data', () => {
      const json = Buffer.from(JSON.stringify({version:{name:'1.21.4'},players:{online:3,max:20}}));
      const payload = Buffer.concat([encodeVarint(0),encodeVarint(json.length),json]);
      socket.end(Buffer.concat([encodeVarint(payload.length),payload]));
    });
  });
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  try {
    const result = await minecraftStatus('127.0.0.1',mock.address().port);
    assert.equal(result.online,true);
    assert.equal(result.players,3);
    assert.equal(result.maxPlayers,20);
  } finally { await new Promise(resolve=>mock.close(resolve)); }
});
test('rejeita host ou porta inválidos', async () => {
  await assert.rejects(minecraftStatus('localhost; bad',25565),/inválido/);
  await assert.rejects(minecraftStatus('localhost',0),/inválido/);
});
