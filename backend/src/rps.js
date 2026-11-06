'use strict';
const choices = ['pedra', 'papel', 'tesoura'];
function scoreRps(choice, computer) {
 if (!choices.includes(choice) || !choices.includes(computer)) throw Error('Jogada inválida');
 if (choice === computer) return {result:'draw', points:1};
 const win = choices[(choices.indexOf(choice) + 2) % 3] === computer;
 return win ? {result:'win',points:5} : {result:'loss',points:0};
}
module.exports = {choices,scoreRps};
