import logger from "./logger";

/**
 * 간단한 날짜 형식을 ISO 8601 형식으로 변환
 * @param dateStr - yyyy-mm-dd, yyyy-mm, yyyy 형식의 날짜 문자열
 * @param isEndDate - 종료 날짜인 경우 true (23:59:59로 설정)
 * @returns ISO 8601 형식의 날짜 문자열
 */
export const convertToISO8601 = (
  dateStr: string,
  isEndDate: boolean = false
): string => {
  try {
    // 이미 ISO 8601 형식인 경우 그대로 반환
    if (dateStr.includes("T") && dateStr.includes("Z")) {
      return dateStr;
    }

    let isoDate: string;

    // yyyy-mm-dd 형식
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      isoDate = isEndDate ? `${dateStr}T23:59:59Z` : `${dateStr}T00:00:00Z`;
    }
    // yyyy-mm 형식
    else if (/^\d{4}-\d{2}$/.test(dateStr)) {
      if (isEndDate) {
        // 해당 월의 마지막 날을 구하기
        const [year, month] = dateStr.split("-").map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        isoDate = `${dateStr}-${lastDay.toString().padStart(2, "0")}T23:59:59Z`;
      } else {
        isoDate = `${dateStr}-01T00:00:00Z`;
      }
    }
    // yyyy 형식
    else if (/^\d{4}$/.test(dateStr)) {
      isoDate = isEndDate
        ? `${dateStr}-12-31T23:59:59Z`
        : `${dateStr}-01-01T00:00:00Z`;
    }
    // 그 외의 경우 그대로 반환 (에러 처리는 GitHub API에서)
    else {
      return dateStr;
    }

    // 유효한 날짜인지 검증
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${dateStr}`);
    }

    return isoDate;
  } catch (error) {
    logger.warn({ dateStr, error }, "Failed to convert date format");
    return dateStr; // 변환 실패 시 원본 반환
  }
};
