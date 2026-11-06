-- Evita duplicar resultados de uma mesma dupla na mesma rodada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_round_pair ON tournament_matches
(tournament_id, round, (LEAST(player1_id, player2_id)), (GREATEST(player1_id, player2_id)))
WHERE played_at IS NOT NULL;
