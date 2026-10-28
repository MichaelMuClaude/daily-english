-- Daily English schema (Azure SQL / SQL Server). Safe to run more than once.

IF OBJECT_ID('dbo.users') IS NULL
CREATE TABLE dbo.users (
  id          INT IDENTITY PRIMARY KEY,
  idp_id      NVARCHAR(200) NOT NULL UNIQUE,   -- stable id from the identity provider (Google sub)
  email       NVARCHAR(320) NULL,
  created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF OBJECT_ID('dbo.sentences') IS NULL
CREATE TABLE dbo.sentences (
  id            INT IDENTITY PRIMARY KEY,
  day           DATE NOT NULL,                 -- Perth calendar day the sentence belongs to
  idx           TINYINT NOT NULL,              -- 1..3 within the day
  english       NVARCHAR(400) NOT NULL,
  chinese       NVARCHAR(400) NOT NULL,
  topic         NVARCHAR(60)  NULL,
  source_title  NVARCHAR(400) NULL,            -- headline of the story it was inspired by
  source_url    NVARCHAR(1000) NULL,
  created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT uq_sentences_day_idx UNIQUE (day, idx)
);

IF OBJECT_ID('dbo.user_sentences') IS NULL
CREATE TABLE dbo.user_sentences (
  user_id       INT NOT NULL REFERENCES dbo.users(id),
  sentence_id   INT NOT NULL REFERENCES dbo.sentences(id),
  learned_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  box           TINYINT NOT NULL DEFAULT 1,    -- Leitner box, 1..5
  next_review   DATE NOT NULL,
  PRIMARY KEY (user_id, sentence_id)
);

IF OBJECT_ID('dbo.reviews') IS NULL
CREATE TABLE dbo.reviews (
  id            INT IDENTITY PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES dbo.users(id),
  sentence_id   INT NOT NULL REFERENCES dbo.sentences(id),
  answer        NVARCHAR(400) NOT NULL,
  score         TINYINT NOT NULL,
  correct       BIT NOT NULL,
  feedback      NVARCHAR(1000) NULL,
  reviewed_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_user_sentences_due')
CREATE INDEX ix_user_sentences_due ON dbo.user_sentences (user_id, next_review);

-- Chinese explanation of the hard words and phrases (JSON: {"notes":[{"phrase","zh"}],"tip":"..."})
IF COL_LENGTH('dbo.sentences', 'explain') IS NULL
ALTER TABLE dbo.sentences ADD explain NVARCHAR(MAX) NULL;

-- Cached MP3 of the sentence read by the cloud neural voice (generated once, on first Listen)
IF COL_LENGTH('dbo.sentences', 'audio') IS NULL
ALTER TABLE dbo.sentences ADD audio VARBINARY(MAX) NULL;
