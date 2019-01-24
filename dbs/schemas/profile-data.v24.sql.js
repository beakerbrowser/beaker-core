module.exports = `

CREATE TABLE users (
  id INTEGER PRIMARY KEY NOT NULL,
  url TEXT,
  isDefault INTEGER DEFAULT 0,
  createdAt INTEGER
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

  PRIMARY KEY (crawlSourceId, pathname),
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

  url TEXT,
  title TEXT,
  description TEXT,
  type TEXT, -- comma separated strings
  createdAt INTEGER,
  updatedAt INTEGER,

  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE crawl_posts_fts_index USING fts5(title, description, content='crawl_posts');

-- triggers to keep crawl_posts_fts_index updated
CREATE TRIGGER crawl_posts_ai AFTER INSERT ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER crawl_posts_ad AFTER DELETE ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(crawl_posts_fts_index, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER crawl_posts_au AFTER UPDATE ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(crawl_posts_fts_index, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
  INSERT INTO crawl_posts_fts_index(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

-- crawled follows
CREATE TABLE crawl_followgraph (
  crawlSourceId INTEGER NOT NULL,
  crawledAt INTEGER,
  
  destUrl TEXT NOT NULL,

  PRIMARY KEY (crawlSourceId, destUrl),
  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);

-- crawled site publications
CREATE TABLE crawl_published_sites (
  crawlSourceId INTEGER NOT NULL,
  crawledAt INTEGER,
  
  url TEXT NOT NULL,
  isConfirmedAuthor INTEGER DEFAULT 0,

  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);

PRAGMA user_version = 24;
`