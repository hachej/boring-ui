CREATE TABLE users (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(100) NOT NULL,
  email     VARCHAR(255) UNIQUE NOT NULL,
  role      VARCHAR(50) DEFAULT 'viewer',
  active    BOOLEAN DEFAULT true,
  created   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users (role);

INSERT INTO users (name, email, role) VALUES
  ('Alice', 'alice@example.com', 'admin'),
  ('Bob',   'bob@example.com',   'editor'),
  ('Carol', 'carol@example.com', 'viewer');
