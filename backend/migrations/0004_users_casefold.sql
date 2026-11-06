-- Impede contas distintas apenas por diferença de maiúsculas/minúsculas.
-- Se houver dados legados duplicados, a migração aborta sem apagar usuários.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_casefold ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_casefold ON users (lower(email));
