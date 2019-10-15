module.exports = `

ALTER TABLE archives_meta ADD COLUMN type TEXT;
DROP TABLE IF EXISTS archives_meta_type;

-- crawled dats
CREATE TABLE crawl_dats (
  crawlSourceId INTEGER NOT NULL,
  crawledAt INTEGER,
  
  key TEXT NOT NULL,
  title TEXT,
  description TEXT,
  type TEXT,

  PRIMARY KEY (crawlSourceId, key),
  FOREIGN KEY (crawlSourceId) REFERENCES crawl_sources (id) ON DELETE CASCADE
);

PRAGMA user_version = 41;
`