module.exports = `

-- add the 'hidden' flag to archives
ALTER TABLE archives ADD COLUMN hidden INTEGER DEFAULT 0;

-- add a database for tracking draft dats
CREATE TABLE archive_drafts (
  profileId INTEGER,
  masterKey TEXT, -- key of the master dat
  draftKey TEXT, -- key of the draft dat
  isActive INTEGER, -- is this the active draft?
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

PRAGMA user_version = 19;
`