-- Permite exclusão segura de usuários sem impedir o ON DELETE SET NULL.
ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_friendships_receiver ON friendships(receiver_id,status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsvps_user ON event_rsvps(user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_members ON tournament_participants(user_id);
-- Impede duas amizades duplicadas com remetente e destinatário invertidos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_pair ON friendships (LEAST(sender_id,receiver_id),GREATEST(sender_id,receiver_id));
