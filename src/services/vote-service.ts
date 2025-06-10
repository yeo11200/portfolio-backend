import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import logger from "../utils/logger";
import supabaseClient from "../config/supabase-client";

// 투표 타입 (boolean으로 변경: true=찬성, false=반대)
export type VoteType = boolean;

// 후보자 투표 인터페이스
export interface CandidateVote {
  id?: string;
  candidate_id: string;
  user_id: string;
  vote_type: VoteType;
  created_at?: string;
  updated_at?: string;
}

// 투표 통계 인터페이스 (찬성/반대로 변경)
export interface VoteStats {
  support: number;
  oppose: number;
  total: number;
}

/**
 * 후보자에 투표하기
 */
export const voteCandidateById = async (
  candidateId: string,
  userId: string,
  voteType: VoteType
): Promise<CandidateVote | null> => {
  try {
    // 기존 투표 확인
    const { data: existingVote } = await supabaseClient
      .from("candidate_votes")
      .select("*")
      .eq("candidate_id", candidateId)
      .eq("user_id", userId)
      .maybeSingle();

    console.log("existingVote", existingVote, candidateId, userId, voteType);
    const now = new Date().toISOString();

    if (existingVote) {
      // 기존 투표 업데이트
      const { data, error } = await supabaseClient
        .from("candidate_votes")
        .update({
          vote_type: voteType,
          updated_at: now,
        })
        .eq("id", existingVote.id)
        .select()
        .single();

      if (error) {
        logger.error(
          { error, candidateId, userId },
          "Error updating candidate vote"
        );
        return null;
      }

      logger.info({ voteId: data.id }, "Successfully updated candidate vote");
      return data;
    } else {
      // 새 투표 생성
      const { data, error } = await supabaseClient
        .from("candidate_votes")
        .insert({
          candidate_id: candidateId,
          user_id: userId,
          vote_type: voteType,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single();

      if (error) {
        logger.error(
          { error, candidateId, userId },
          "Error creating candidate vote"
        );
        return null;
      }

      logger.info({ voteId: data.id }, "Successfully created candidate vote");
      return data;
    }
  } catch (error) {
    logger.error(
      { error, candidateId, userId },
      "Exception when voting for candidate"
    );
    return null;
  }
};

/**
 * 사용자의 후보자 투표 조회
 */
export const getUserCandidateVote = async (
  candidateId: string,
  userId: string
): Promise<CandidateVote | null> => {
  try {
    const { data, error } = await supabaseClient
      .from("candidate_votes")
      .select("*")
      .eq("candidate_id", candidateId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      logger.error(
        { error, candidateId, userId },
        "Error fetching user's candidate vote"
      );
      return null;
    }

    return data;
  } catch (error) {
    logger.error(
      { error, candidateId, userId },
      "Exception when fetching user's candidate vote"
    );
    return null;
  }
};

/**
 * 후보자 투표 통계 조회
 */
export const getCandidateVoteStats = async (
  candidateId: string
): Promise<VoteStats> => {
  try {
    const { data, error } = await supabaseClient
      .from("candidate_votes")
      .select("vote_type, user_id")
      .eq("candidate_id", candidateId);

    if (error) {
      logger.error(
        { error, candidateId },
        "Error fetching candidate vote stats"
      );
      return { support: 0, oppose: 0, total: 0 };
    }

    // 중복 유저 제거 (최신 투표만 유지)
    const uniqueVotes = new Map<string, boolean>();
    for (const vote of data) {
      uniqueVotes.set(vote.user_id, vote.vote_type);
    }

    // 각 유저의 최종 투표만 계산
    const finalVotes = Array.from(uniqueVotes.values());

    const stats: VoteStats = {
      support: finalVotes.filter((voteType) => voteType === true).length,
      oppose: finalVotes.filter((voteType) => voteType === false).length,
      total: finalVotes.length,
    };

    return stats;
  } catch (error) {
    logger.error(
      { error, candidateId },
      "Exception when fetching candidate vote stats"
    );
    return { support: 0, oppose: 0, total: 0 };
  }
};

/**
 * 모든 후보자 투표 통계 조회 - 총 투표자 수와 후보자별 투표 수 포함
 */
export const getAllCandidateVoteStats = async (): Promise<{
  total: number;
  candidates: Record<string, number>;
}> => {
  try {
    const { data, error } = await supabaseClient
      .from("candidate_votes")
      .select("candidate_id, user_id");

    if (error) {
      logger.error({ error }, "Error fetching all candidate vote stats");
      return { total: 0, candidates: {} };
    }

    // 유니크한 투표자 수 계산
    const uniqueVoters = new Set<string>();

    // 후보자별 투표 수 계산 (각 사용자는 후보자당 한 번만 카운트)
    const candidateVoters = new Map<string, Set<string>>();

    for (const vote of data) {
      // 전체 유니크 투표자 추가
      uniqueVoters.add(vote.user_id);

      // 후보자별 유니크 투표자 추가
      if (!candidateVoters.has(vote.candidate_id)) {
        candidateVoters.set(vote.candidate_id, new Set<string>());
      }
      candidateVoters.get(vote.candidate_id)?.add(vote.user_id);
    }

    // 후보자별 투표자 수를 객체로 변환
    const candidateStats: Record<string, number> = {};
    for (const [candidateId, voters] of candidateVoters.entries()) {
      candidateStats[candidateId] = voters.size;
    }

    return {
      total: uniqueVoters.size,
      candidates: candidateStats,
    };
  } catch (error) {
    logger.error({ error }, "Exception when fetching all candidate vote stats");
    return { total: 0, candidates: {} };
  }
};

/**
 * 후보자 투표 삭제
 */
export const deleteCandidateVote = async (
  candidateId: string,
  userId: string
): Promise<boolean> => {
  try {
    const { error } = await supabaseClient
      .from("candidate_votes")
      .delete()
      .eq("candidate_id", candidateId)
      .eq("user_id", userId);

    if (error) {
      logger.error(
        { error, candidateId, userId },
        "Error deleting candidate vote"
      );
      return false;
    }

    logger.info({ candidateId, userId }, "Successfully deleted candidate vote");
    return true;
  } catch (error) {
    logger.error(
      { error, candidateId, userId },
      "Exception when deleting candidate vote"
    );
    return false;
  }
};

/**
 * 사용자가 특정 후보자에게 찬성 투표했는지 여부만 확인
 * @returns true: 찬성 투표함, false: 찬성 투표하지 않음(투표 안했거나 반대 투표)
 */
export const hasUserVotedForCandidate = async (
  candidateId: string,
  userId: string
): Promise<boolean> => {
  try {
    const { data, error } = await supabaseClient
      .from("candidate_votes")
      .select("vote_type")
      .eq("candidate_id", candidateId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      logger.error(
        { error, candidateId, userId },
        "Error checking if user voted for candidate"
      );
      return false;
    }

    // data가 없으면 투표하지 않은 것, vote_type이 true면 찬성 투표
    return data?.vote_type === true;
  } catch (error) {
    logger.error(
      { error, candidateId, userId },
      "Exception when checking if user voted for candidate"
    );
    return false;
  }
};

/**
 * 사용자가 어떤 후보자든 투표한 적이 있는지 여부만 확인
 * @returns true: 투표한 적 있음, false: 투표한 적 없음
 */
export const hasUserVotedAny = async (userId: string): Promise<boolean> => {
  try {
    const { data, error, count } = await supabaseClient
      .from("candidate_votes")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      logger.error(
        { error, userId },
        "Error checking if user voted for any candidate"
      );
      return false;
    }

    // count가 0보다 크면 투표한 적이 있는 것
    return (count ?? 0) > 0;
  } catch (error) {
    logger.error(
      { error, userId },
      "Exception when checking if user voted for any candidate"
    );
    return false;
  }
};

export default {
  voteCandidateById,
  getUserCandidateVote,
  getCandidateVoteStats,
  getAllCandidateVoteStats,
  deleteCandidateVote,
  hasUserVotedForCandidate,
  hasUserVotedAny,
};
