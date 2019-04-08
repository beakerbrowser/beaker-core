module.exports = `
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY NOT NULL,
  url TEXT,
  createdAt INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY NOT NULL,
  url TEXT,
  isDefault INTEGER DEFAULT 0,
  createdAt INTEGER
);

CREATE TABLE archives (
  profileId INTEGER NOT NULL,
  key TEXT NOT NULL, -- dat key
  
  previewMode INTEGER, -- automatically publish changes (0) or write to local folder (1)
  localSyncPath TEXT, -- custom local folder that the data is synced to

  isSaved INTEGER, -- is this archive saved to our library?
  hidden INTEGER DEFAULT 0, -- should this archive be hidden in the library or select-archive modals? (this is useful for internal dats, such as drafts)
  networked INTEGER DEFAULT 1, -- join the swarm (1) or do not swarm (0)
  autoDownload INTEGER DEFAULT 1, -- watch and download all available data (1) or sparsely download on demand (0)
  autoUpload INTEGER DEFAULT 1, -- join the swarm at startup (1) or only swarm when visiting (0)
  expiresAt INTEGER, -- change autoUpload to 0 at this time (used for temporary seeding)
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  localPath TEXT, -- deprecated
  autoPublishLocal INTEGER DEFAULT 0 -- deprecated -- watch localSyncPath and automatically publish changes (1) or not (0)
);

CREATE TABLE archives_meta (
  key TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  mtime INTEGER,
  size INTEGER,
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

CREATE TABLE bookmarks (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  isPublic INTEGER,
  pinned INTEGER,
  pinOrder INTEGER DEFAULT 0,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  tags TEXT,
  notes TEXT,

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

-- list of dats being looked for
CREATE TABLE watchlist (
  profileId INTEGER NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL,
  seedWhenResolved BOOLEAN NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT (0),
  updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
 
  PRIMARY KEY (profileId, url),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- list of the users current templates
CREATE TABLE templates (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  screenshot,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  PRIMARY KEY (profileId, url),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- list of sites being crawled
CREATE TABLE crawl_sources (
  id INTEGER PRIMARY KEY NOT NULL,
  url TEXT NOT NULL
);

-- tracking information on the crawl-state of the sources
CREATE TABLE crawl_sources_meta (
  crawlSourceId INTEGER NOT NULL,
  crawlSourceVersion INTEGER NOT NULL,
  crawlDataset TEXT NOT NULL,
  crawlDatasetVersion INTEGER NOT NULL,
  updatedAt INTEGER,

  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);

-- crawled descriptions of other sites
CREATE TABLE crawl_site_descriptions (
  crawlSourceId INTEGER NOT NULL,
  crawledAt INTEGER,

  url TEXT,
  title TEXT,
  description TEXT,
  type TEXT, -- comma separated strings

  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE crawl_site_descriptions_fts_index USING fts5(title, description, content='crawl_site_descriptions');

-- triggers to keep crawl_site_descriptions_fts_index updated
CREATE TRIGGER crawl_site_descriptions_ai AFTER INSERT ON crawl_site_descriptions BEGIN
  INSERT INTO crawl_site_descriptions_fts_index(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER crawl_site_descriptions_ad AFTER DELETE ON crawl_site_descriptions BEGIN
  INSERT INTO crawl_site_descriptions_fts_index(crawl_site_descriptions_fts_index, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER crawl_site_descriptions_au AFTER UPDATE ON crawl_site_descriptions BEGIN
  INSERT INTO crawl_site_descriptions_fts_index(crawl_site_descriptions_fts_index, rowid, title, description) VALUES('delete', old.a, old.title, old.description);
  INSERT INTO crawl_site_descriptions_fts_index(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

-- crawled posts
CREATE TABLE crawl_posts (
  crawlSourceId INTEGER NOT NULL,
  pathname TEXT NOT NULL,
  crawledAt INTEGER,

  body TEXT,
  createdAt INTEGER,
  updatedAt INTEGER,

  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE crawl_posts_fts_index USING fts5(body, content='crawl_posts');

-- triggers to keep crawl_posts_fts_index updated
CREATE TRIGGER crawl_posts_ai AFTER INSERT ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER crawl_posts_ad AFTER DELETE ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(crawl_posts_fts_index, rowid, body) VALUES('delete', old.rowid, old.body);
END;
CREATE TRIGGER crawl_posts_au AFTER UPDATE ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(crawl_posts_fts_index, rowid, body) VALUES('delete', old.rowid, old.body);
  INSERT INTO crawl_posts_fts_index(rowid, body) VALUES (new.rowid, new.body);
END;

-- crawled bookmarks
CREATE TABLE crawl_bookmarks (
  crawlSourceId INTEGER NOT NULL,
  pathname TEXT NOT NULL,
  crawledAt INTEGER,

  href TEXT,
  title TEXT,
  description TEXT,
  tags TEXT,
  createdAt INTEGER,
  updatedAt INTEGER,

  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE crawl_bookmarks_fts_index USING fts5(title, description, tags, content='crawl_bookmarks');

-- triggers to keep crawl_bookmarks_fts_index updated
CREATE TRIGGER crawl_bookmarks_ai AFTER INSERT ON crawl_bookmarks BEGIN
  INSERT INTO crawl_bookmarks_fts_index(rowid, title, description, tags) VALUES (new.rowid, new.title, new.description, new.tags);
END;
CREATE TRIGGER crawl_bookmarks_ad AFTER DELETE ON crawl_bookmarks BEGIN
  INSERT INTO crawl_bookmarks_fts_index(crawl_bookmarks_fts_index, rowid, title, description, tags) VALUES('delete', old.rowid, old.title, old.description, old.tags);
END;
CREATE TRIGGER crawl_bookmarks_au AFTER UPDATE ON crawl_bookmarks BEGIN
  INSERT INTO crawl_bookmarks_fts_index(crawl_bookmarks_fts_index, rowid, title, description, tags) VALUES('delete', old.rowid, old.title, old.description, old.tags);
  INSERT INTO crawl_bookmarks_fts_index(rowid, title, description, tags) VALUES (new.rowid, new.title, new.description, new.tags);
END;

-- crawled follows
CREATE TABLE crawl_graph (
  crawlSourceId INTEGER NOT NULL,
  crawledAt INTEGER,
  
  destUrl TEXT NOT NULL,

  PRIMARY KEY (crawlSourceId, destUrl),
  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);

-- a list of the draft-dats for a master-dat
-- deprecated
CREATE TABLE archive_drafts (
  profileId INTEGER,
  masterKey TEXT, -- key of the master dat
  draftKey TEXT, -- key of the draft dat
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  isActive INTEGER, -- is this the active draft? (deprecated)

  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- list of the users installed apps
-- deprecated (may return)
CREATE TABLE apps (
  profileId INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
 
  PRIMARY KEY (profileId, name),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- log of the users app installations
-- deprecated (may return)
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
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Beaker Browser', 'dat://beakerbrowser.com', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Dat Project', 'dat://datproject.org', 0);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Hashbase', 'https://hashbase.io', 0);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Documentation', 'dat://beakerbrowser.com/docs', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Report an issue', 'https://github.com/beakerbrowser/beaker/issues', 0);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Support Beaker', 'https://opencollective.com/beaker', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Address book', 'beaker://library/?view=addressbook', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Beaker.Social', 'dat://beaker.social', 1);

PRAGMA user_version = 24;
`
