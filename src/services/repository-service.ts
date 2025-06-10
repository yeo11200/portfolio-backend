import axios from "axios";
import supabaseClient from "../config/supabase-client";
import logger from "../utils/logger";

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
  };
  description: string;
  html_url: string;
  language: string;
  stargazers_count: number;
  forks_count: number;
}

export interface RepositoryContent {
  name: string;
  path: string;
  type: string;
  content?: string;
  sha: string;
}

export interface Commit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: string;
  created_at: string;
  merged_at: string | null;
}

/**
 * 사용자의 GitHub 레포지토리 목록 가져오기
 */
export const getUserRepositories = async (
  accessToken: string,
  sort: string = "updated",
  direction: string = "desc",
  search: string = ""
): Promise<Repository[]> => {
  try {
    let url = "https://api.github.com/user/repos";
    const params: Record<string, string> = {
      sort,
      direction,
      per_page: "100",
    };

    if (search) {
      params.q = search;
    }

    const response = await axios.get(url, {
      params,
      headers: {
        Authorization: `token ${accessToken}`,
      },
    });

    return response.data;
  } catch (error) {
    logger.error({ error }, "Error fetching user repositories");
    throw new Error("Failed to fetch user repositories");
  }
};

/**
 * 특정 레포지토리 정보 가져오기
 */
export const getRepository = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<Repository> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error({ error, owner, repo }, "Error fetching repository");
    throw new Error("Failed to fetch repository");
  }
};

/**
 * 레포지토리 README 가져오기
 */
export const getRepositoryReadme = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<string> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
          Accept: "application/vnd.github.v3.raw",
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error({ error, owner, repo }, "Error fetching repository README");
    return "";
  }
};

/**
 * 레포지토리 브랜치 목록 가져오기
 */
export const getRepositoryBranches = async (
  accessToken: string,
  owner: string,
  repo: string
): Promise<string[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/branches`,
      {
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data.map((branch: any) => branch.name);
  } catch (error) {
    logger.error({ error, owner, repo }, "Error fetching repository branches");
    throw new Error("Failed to fetch repository branches");
  }
};

/**
 * 레포지토리 디렉토리 내용 가져오기
 */
export const getRepositoryContents = async (
  accessToken: string,
  owner: string,
  repo: string,
  path: string = "",
  ref: string = "main"
): Promise<RepositoryContent[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        params: { ref },
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error(
      { error, owner, repo, path },
      "Error fetching repository contents"
    );
    throw new Error("Failed to fetch repository contents");
  }
};

/**
 * 레포지토리 커밋 목록 가져오기
 */
export const getRepositoryCommits = async (
  accessToken: string,
  owner: string,
  repo: string,
  branch: string = "main",
  perPage: number = 100
): Promise<Commit[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits`,
      {
        params: {
          sha: branch,
          per_page: perPage,
        },
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error(
      { error, owner, repo, branch },
      "Error fetching repository commits"
    );
    throw new Error("Failed to fetch repository commits");
  }
};

/**
 * 레포지토리 PR 목록 가져오기
 */
export const getRepositoryPullRequests = async (
  accessToken: string,
  owner: string,
  repo: string,
  state: string = "all",
  perPage: number = 100
): Promise<PullRequest[]> => {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        params: {
          state,
          per_page: perPage,
        },
        headers: {
          Authorization: `token ${accessToken}`,
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error(
      { error, owner, repo },
      "Error fetching repository pull requests"
    );
    throw new Error("Failed to fetch repository pull requests");
  }
};

/**
 * 레포지토리 정보 저장
 */
export const saveRepository = async (
  userId: string,
  repo: Repository
): Promise<string> => {
  try {
    const { data, error } = await supabaseClient
      .from("repositories")
      .upsert(
        {
          user_id: userId,
          github_repo_id: repo.id.toString(),
          owner: repo.owner.login,
          name: repo.name,
          description: repo.description,
          html_url: repo.html_url,
          language: repo.language,
          stars_count: repo.stargazers_count,
          forks_count: repo.forks_count,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,github_repo_id" }
      )
      .select("id")
      .single();

    if (error) {
      logger.error({ error, userId, repo }, "Error saving repository");
      throw new Error("Failed to save repository");
    }

    return data.id;
  } catch (error) {
    logger.error({ error, userId, repo }, "Exception when saving repository");
    throw new Error("Failed to save repository");
  }
};

/**
 * 사용자의 저장된 레포지토리 목록 가져오기
 */
export const getSavedRepositories = async (
  userId: string,
  sort: string = "updated_at",
  direction: string = "desc",
  search: string = ""
): Promise<any[]> => {
  try {
    let query = supabaseClient
      .from("repositories")
      .select("*")
      .eq("user_id", userId)
      .order(sort, { ascending: direction === "asc" });

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      logger.error({ error, userId }, "Error fetching saved repositories");
      throw new Error("Failed to fetch saved repositories");
    }

    return data;
  } catch (error) {
    logger.error(
      { error, userId },
      "Exception when fetching saved repositories"
    );
    throw new Error("Failed to fetch saved repositories");
  }
};

/**
 * 레포지토리 커밋 히스토리 저장
 */
export const saveCommitHistory = async (
  repositoryId: string,
  commits: Commit[]
): Promise<void> => {
  try {
    const commitRecords = commits.map((commit) => ({
      repository_id: repositoryId,
      commit_sha: commit.sha,
      author_name: commit.commit.author.name,
      author_email: commit.commit.author.email,
      commit_date: commit.commit.author.date,
      commit_message: commit.commit.message,
    }));

    const { error } = await supabaseClient
      .from("commit_history")
      .upsert(commitRecords, { onConflict: "repository_id,commit_sha" });

    if (error) {
      logger.error({ error, repositoryId }, "Error saving commit history");
      throw new Error("Failed to save commit history");
    }
  } catch (error) {
    logger.error(
      { error, repositoryId },
      "Exception when saving commit history"
    );
    throw new Error("Failed to save commit history");
  }
};

/**
 * 레포지토리 PR 히스토리 저장
 */
export const savePullRequests = async (
  repositoryId: string,
  pullRequests: PullRequest[]
): Promise<void> => {
  try {
    const prRecords = pullRequests.map((pr) => ({
      repository_id: repositoryId,
      pr_number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      created_at: pr.created_at,
      merged_at: pr.merged_at,
    }));

    const { error } = await supabaseClient
      .from("pull_requests")
      .upsert(prRecords, { onConflict: "repository_id,pr_number" });

    if (error) {
      logger.error({ error, repositoryId }, "Error saving pull requests");
      throw new Error("Failed to save pull requests");
    }
  } catch (error) {
    logger.error(
      { error, repositoryId },
      "Exception when saving pull requests"
    );
    throw new Error("Failed to save pull requests");
  }
};

export default {
  getUserRepositories,
  getRepository,
  getRepositoryReadme,
  getRepositoryBranches,
  getRepositoryContents,
  getRepositoryCommits,
  getRepositoryPullRequests,
  saveRepository,
  getSavedRepositories,
  saveCommitHistory,
  savePullRequests,
};
