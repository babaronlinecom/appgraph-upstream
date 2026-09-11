CREATE TABLE members (
  team_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member',
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE members
  ADD CONSTRAINT members_team_fk FOREIGN KEY (team_id) REFERENCES teams(id);
