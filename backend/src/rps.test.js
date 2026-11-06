'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {choices,scoreRps}=require('./rps');
test('pedra ganha de tesoura; papel de pedra; tesoura de papel',()=>{
 for(const [choice,computer] of [['pedra','tesoura'],['papel','pedra'],['tesoura','papel']])assert.deepEqual(scoreRps(choice,computer),{result:'win',points:5});
});
test('vitória, derrota e empate têm pontos corretos',()=>{
 for(const choice of choices)assert.deepEqual(scoreRps(choice,choice),{result:'draw',points:1});
 for(const [choice,computer] of [['tesoura','pedra'],['pedra','papel'],['papel','tesoura']])assert.deepEqual(scoreRps(choice,computer),{result:'loss',points:0});
});
test('jogadas inválidas são rejeitadas',()=>assert.throws(()=>scoreRps('hack','pedra'),/inválida/));
