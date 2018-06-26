module.exports = `
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY NOT NULL,
  url TEXT,
  createdAt INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE archives (
  profileId INTEGER NOT NULL,
  key TEXT NOT NULL, -- dat key
  localSyncPath TEXT, -- local FS file that the data is bidirectionally synced to
  isSaved INTEGER, -- is this archive saved to our library?
  hidden INTEGER DEFAULT 0, -- should this archive be hidden in the library or select-archive modals? (this is useful for internal dats, such as drafts)
  autoDownload INTEGER DEFAULT 1, -- optimistically download all available data (1) or sparsely download on demand (0)
  autoUpload INTEGER DEFAULT 1,
  networked INTEGER DEFAULT 1, -- get on the swarm (1) or do not replicate (0)
  expiresAt INTEGER, -- remove from library at this time (used for temporary seeding)
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  localPath TEXT -- deprecated
);

CREATE TABLE archives_meta (
  key TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  mtime INTEGER,
  isOwner INTEGER,
  lastAccessTime INTEGER DEFAULT 0,
  lastLibraryAccessTime INTEGER DEFAULT 0,

  forkOf TEXT, -- deprecated
  createdByUrl TEXT, -- deprecated
  createdByTitle TEXT, -- deprecated
  metaSize INTEGER, -- deprecated
  stagingSize INTEGER -- deprecated
);

CREATE TABLE archives_meta_type (
  key TEXT,
  type TEXT
);

-- a list of the draft-dats for a master-dat
CREATE TABLE archive_drafts (
  profileId INTEGER,
  masterKey TEXT, -- key of the master dat
  draftKey TEXT, -- key of the draft dat
  isActive INTEGER, -- is this the active draft?
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

CREATE TABLE bookmarks (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  pinned INTEGER,
  pinOrder INTEGER DEFAULT 0,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  tags TEXT,
  notes TEXT,

  PRIMARY KEY (profileId, url),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

CREATE TABLE templates (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  screenshot,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  PRIMARY KEY (profileId, url),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

CREATE TABLE visits (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  ts INTEGER NOT NULL,

  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE INDEX visits_url ON visits (url);

CREATE TABLE visit_stats (
  url TEXT NOT NULL,
  num_visits INTEGER,
  last_visit_ts INTEGER
);

CREATE VIRTUAL TABLE visit_fts USING fts4 (url, title);
CREATE UNIQUE INDEX visits_stats_url ON visit_stats (url);

-- list of the user's installed apps
-- deprecated
CREATE TABLE apps (
  profileId INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
 
  PRIMARY KEY (profileId, name),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- log of the user's app installations
-- deprecated
CREATE TABLE apps_log (
  profileId INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  ts INTEGER DEFAULT (strftime('%s', 'now')),
 
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- deprecated
CREATE TABLE workspaces (
  profileId INTEGER NOT NULL,
  name TEXT NOT NULL,
  localFilesPath TEXT,
  publishTargetUrl TEXT,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  updatedAt INTEGER DEFAULT (strftime('%s', 'now')),

  PRIMARY KEY (profileId, name),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- default profile
INSERT INTO profiles (id) VALUES (0);

-- default bookmarks
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Beaker Home', 'dat://beakerbrowser.com', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Dat Project', 'dat://datproject.org', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, '@BeakerBrowser', 'https://twitter.com/beakerbrowser', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Hashbase', 'https://hashbase.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Documentation', 'dat://beakerbrowser.com/docs', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Report an issue', 'https://github.com/beakerbrowser/beaker/issues', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Explore the p2p Web', 'dat://taravancil.com/explore-the-p2p-web.md', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Support Beaker', 'https://opencollective.com/beaker', 1);

PRAGMA user_version = 17;
`
