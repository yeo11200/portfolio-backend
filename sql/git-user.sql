-- 사용자 테이블
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  github_id VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(255) NOT NULL,
  avatar_url TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 저장된 레포지토리 테이블
CREATE TABLE repositories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  github_repo_id VARCHAR(255) NOT NULL,
  owner VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  html_url TEXT,
  language VARCHAR(100),
  stars_count INTEGER DEFAULT 0,
  forks_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, github_repo_id)
);

-- 레포지토리 요약 테이블
CREATE TABLE repository_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  project_intro TEXT,
  tech_stack TEXT,
  refactoring_history TEXT,
  collaboration_flow TEXT,
  resume_bullets TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 커밋 히스토리 테이블
CREATE TABLE commit_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  commit_sha VARCHAR(255) NOT NULL,
  author_name VARCHAR(255),
  author_email VARCHAR(255),
  commit_date TIMESTAMP WITH TIME ZONE,
  commit_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(repository_id, commit_sha)
);

-- PR 히스토리 테이블
CREATE TABLE pull_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  title VARCHAR(255),
  body TEXT,
  state VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE,
  merged_at TIMESTAMP WITH TIME ZONE,
  created_at_record TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(repository_id, pr_number)
);

-- 인덱스 생성
CREATE INDEX idx_repositories_user_id ON repositories(user_id);
CREATE INDEX idx_repository_summaries_repository_id ON repository_summaries(repository_id);
CREATE INDEX idx_commit_history_repository_id ON commit_history(repository_id);
CREATE INDEX idx_pull_requests_repository_id ON pull_requests(repository_id);