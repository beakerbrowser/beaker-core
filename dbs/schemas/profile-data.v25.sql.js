module.exports = `

-- add full-text search indexes
CREATE VIRTUAL TABLE crawl_site_descriptions_fts_index USING fts5(title, description, content='crawl_site_descriptions');
CREATE VIRTUAL TABLE crawl_posts_fts_index USING fts5(content, content='crawl_posts');

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

-- triggers to keep crawl_posts_fts_index updated
CREATE TRIGGER crawl_posts_ai AFTER INSERT ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER crawl_posts_ad AFTER DELETE ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(crawl_posts_fts_index, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER crawl_posts_au AFTER UPDATE ON crawl_posts BEGIN
  INSERT INTO crawl_posts_fts_index(crawl_posts_fts_index, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO crawl_posts_fts_index(rowid, content) VALUES (new.rowid, new.content);
END;

PRAGMA user_version = 25;
`