-- ============================================================
--  SCHEMA COMPLETO — PLATAFORMA GAMER PRIVADA
-- ============================================================

-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── ENUM TYPES ───────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'moderator', 'member');
CREATE TYPE user_status AS ENUM ('online', 'offline', 'away', 'dnd');
CREATE TYPE member_status AS ENUM ('active', 'suspended', 'banned');
CREATE TYPE channel_type AS ENUM ('text', 'voice', 'announcement');
CREATE TYPE event_status AS ENUM ('upcoming', 'ongoing', 'finished', 'cancelled');
CREATE TYPE tournament_status AS ENUM ('open', 'ongoing', 'finished');
CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'blocked');

-- ── USUÁRIOS ─────────────────────────────────────────────
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR(32) UNIQUE NOT NULL,
    email         VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  VARCHAR(64),
    avatar_url    TEXT,
    banner_url    TEXT,
    bio           TEXT,
    role          user_role DEFAULT 'member',
    status        user_status DEFAULT 'offline',
    custom_status VARCHAR(128),
    member_status member_status DEFAULT 'active',
    last_seen_at  TIMESTAMP WITH TIME ZONE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── AMIZADES ─────────────────────────────────────────────
CREATE TABLE friendships (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      friendship_status DEFAULT 'pending',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(sender_id, receiver_id)
);

-- ── SERVIDORES / GRUPOS ──────────────────────────────────
CREATE TABLE servers (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url    TEXT,
    banner_url  TEXT,
    owner_id    UUID NOT NULL REFERENCES users(id),
    is_default  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── CANAIS ───────────────────────────────────────────────
CREATE TABLE channels (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    type        channel_type DEFAULT 'text',
    position    INTEGER DEFAULT 0,
    is_private  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── MENSAGENS ────────────────────────────────────────────
CREATE TABLE messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    edited_at   TIMESTAMP WITH TIME ZONE,
    deleted_at  TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);

-- ── MENSAGENS DIRETAS (DM) ───────────────────────────────
CREATE TABLE direct_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    read_at     TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_dm_conversation ON direct_messages(
    LEAST(sender_id::text, receiver_id::text),
    GREATEST(sender_id::text, receiver_id::text),
    created_at DESC
);

-- ── FÓRUM: POSTS ─────────────────────────────────────────
CREATE TABLE forum_posts (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    content     TEXT NOT NULL,
    category    VARCHAR(50) DEFAULT 'geral',
    thumbnail   TEXT,
    pinned      BOOLEAN DEFAULT FALSE,
    views       INTEGER DEFAULT 0,
    deleted_at  TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── FÓRUM: COMENTÁRIOS ───────────────────────────────────
CREATE TABLE forum_comments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id     UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    reply_to_id UUID REFERENCES forum_comments(id) ON DELETE SET NULL,
    deleted_at  TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── REAÇÕES ──────────────────────────────────────────────
CREATE TABLE reactions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(20) NOT NULL, -- 'post', 'comment', 'message'
    target_id   UUID NOT NULL,
    emoji       VARCHAR(10) DEFAULT '👍',
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, target_type, target_id, emoji)
);

-- ── CLIPES / VÍDEOS ──────────────────────────────────────
CREATE TABLE clips (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    video_url   TEXT NOT NULL,
    thumbnail   TEXT,
    game        VARCHAR(100),
    views       INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── EVENTOS ──────────────────────────────────────────────
CREATE TABLE events (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id   UUID NOT NULL REFERENCES users(id),
    title        VARCHAR(200) NOT NULL,
    description  TEXT,
    cover_url    TEXT,
    game         VARCHAR(100),
    starts_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at      TIMESTAMP WITH TIME ZONE,
    status       event_status DEFAULT 'upcoming',
    max_players  INTEGER,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── CONFIRMAÇÕES DE PRESENÇA ─────────────────────────────
CREATE TABLE event_rsvps (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id    UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    confirmed   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

-- ── ENQUETES ─────────────────────────────────────────────
CREATE TABLE polls (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id  UUID NOT NULL REFERENCES users(id),
    title       VARCHAR(200) NOT NULL,
    ends_at     TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE poll_options (
    id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    poll_id  UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    text     VARCHAR(200) NOT NULL
);

CREATE TABLE poll_votes (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    option_id UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(poll_id, user_id),
    poll_id   UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE
);

-- ── CAMPEONATOS ──────────────────────────────────────────
CREATE TABLE tournaments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    creator_id  UUID NOT NULL REFERENCES users(id),
    name        VARCHAR(200) NOT NULL,
    game        VARCHAR(100) NOT NULL,
    description TEXT,
    rules       TEXT,
    max_players INTEGER DEFAULT 16,
    status      tournament_status DEFAULT 'open',
    starts_at   TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE tournament_participants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registered_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tournament_id, user_id)
);

CREATE TABLE tournament_matches (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tournament_id   UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player1_id      UUID REFERENCES users(id),
    player2_id      UUID REFERENCES users(id),
    winner_id       UUID REFERENCES users(id),
    score_p1        INTEGER DEFAULT 0,
    score_p2        INTEGER DEFAULT 0,
    round           INTEGER DEFAULT 1,
    played_at       TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── RANKING / PONTUAÇÃO ──────────────────────────────────
CREATE TABLE rankings (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    points      INTEGER DEFAULT 0,
    wins        INTEGER DEFAULT 0,
    losses      INTEGER DEFAULT 0,
    games       INTEGER DEFAULT 0,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── CONQUISTAS ───────────────────────────────────────────
CREATE TABLE achievements (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    icon        TEXT,
    points      INTEGER DEFAULT 10
);

CREATE TABLE user_achievements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id  UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    earned_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- ── NOTIFICAÇÕES ─────────────────────────────────────────
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL,
    title       VARCHAR(200) NOT NULL,
    body        TEXT,
    link        TEXT,
    read_at     TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── DENÚNCIAS ────────────────────────────────────────────
CREATE TABLE reports (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(20) NOT NULL, -- 'user', 'message', 'post', 'clip'
    target_id   UUID NOT NULL,
    reason      VARCHAR(200) NOT NULL,
    resolved    BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── MINIGAMES: PONTUAÇÃO ─────────────────────────────────
CREATE TABLE minigame_scores (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game        VARCHAR(50) NOT NULL,
    score       INTEGER DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── LOGS DO SERVIDOR MINECRAFT ───────────────────────────
CREATE TABLE minecraft_logs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action      VARCHAR(50) NOT NULL, -- 'start', 'stop', 'restart'
    performed_by UUID REFERENCES users(id),
    notes       TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── VISTAS DA COMUNIDADE (Avisos) ───────────────────────
CREATE TABLE announcements (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id   UUID NOT NULL REFERENCES users(id),
    title       VARCHAR(200) NOT NULL,
    content     TEXT NOT NULL,
    pinned      BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── TRIGGERS: updated_at automático ─────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_forum_posts_updated BEFORE UPDATE ON forum_posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Lives persistidas e gerenciadas pelos administradores
CREATE TABLE IF NOT EXISTS community_lives (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 name VARCHAR(120) NOT NULL, streamer VARCHAR(80) NOT NULL,
 platform VARCHAR(30) NOT NULL, url TEXT NOT NULL, game VARCHAR(100),
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT now()
);
