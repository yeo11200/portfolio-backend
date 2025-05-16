import puppeteer, { Browser, Page } from "puppeteer";
import cheerio from "cheerio";
import {
  defaultPuppeteerOptions,
  candidateKeywords,
  newsSources,
} from "../config/puppeteer-config";
import logger from "../utils/logger";
import { NewsItem } from "./supabase-service";

// 브라우저 인스턴스 캐시
let browserInstance: Browser | null = null;

/**
 * Puppeteer 브라우저 인스턴스 가져오기
 * @returns Puppeteer 브라우저 객체
 */
export const getBrowser = async (): Promise<Browser> => {
  if (!browserInstance || !browserInstance.isConnected()) {
    try {
      browserInstance = await puppeteer.launch(defaultPuppeteerOptions);
      logger.info("New Puppeteer browser instance created");
    } catch (error) {
      logger.error({ error }, "Error launching Puppeteer");
      throw error;
    }
  }
  return browserInstance;
};

/**
 * 브라우저 인스턴스 종료
 */
export const closeBrowser = async (): Promise<void> => {
  if (browserInstance && browserInstance.isConnected()) {
    await browserInstance.close();
    browserInstance = null;
    logger.info("Puppeteer browser instance closed");
  }
};

/**
 * 네이버 뉴스 검색 및 스크래핑
 * @param candidate 후보자 이름
 * @param keyword 검색 키워드
 * @returns 스크래핑된 뉴스 목록
 */
export const scrapeNaverNews = async (
  candidate: string,
  keyword: string
): Promise<NewsItem[]> => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const results: NewsItem[] = [];

  try {
    // 검색 URL 구성
    const searchQuery = `${candidate} ${keyword}`;
    const searchUrl = `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(
      searchQuery
    )}`;

    // 유저 에이전트 설정 (크롤링 방지 우회용)
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
    );

    // 검색 페이지 로드
    logger.info({ url: searchUrl }, "Starting to load Naver search page");
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
    logger.info({ url: searchUrl }, "Loaded Naver search page");

    // 페이지 HTML 가져와서 로깅 (디버깅용)
    const pageContent = await page.content();
    logger.info(`Page content length: ${pageContent.length} bytes`);

    // 페이지 스크린샷 캡처
    await page.screenshot({ path: "naver-search.png" });
    logger.info("Page screenshot saved as naver-search.png");

    // 뉴스 링크 추출 (다양한 선택자 시도)
    const newsLinks = await page.evaluate(() => {
      const links: string[] = [];

      // 원래 선택자
      let elements = document.querySelectorAll(".news_tit");

      // 원래 선택자로 찾지 못하면 대체 선택자 시도
      if (elements.length === 0) {
        elements = document.querySelectorAll(".news_area a.news_tit");
      }

      // 또 다른 대체 선택자
      if (elements.length === 0) {
        elements = document.querySelectorAll("a.news_tit");
      }

      // 일반적인 뉴스 링크 선택자
      if (elements.length === 0) {
        elements = document.querySelectorAll(
          ".news_wrap a[href*='news.naver.com']"
        );
      }

      console.log("Found elements:", elements.length);

      elements.forEach((el) => {
        const link = el.getAttribute("href");
        if (link) {
          console.log("Found link:", link);
          links.push(link);
        }
      });

      return links.slice(0, 5); // 최대 5개만 처리
    });

    logger.info({ count: newsLinks.length }, "Found news links");

    if (newsLinks.length === 0) {
      logger.warn("No news links found on the Naver search page");
      return results;
    }

    // 각 뉴스 링크 방문하여 데이터 추출
    for (const link of newsLinks) {
      try {
        // 새 탭에서 기사 열기
        const newsPage = await browser.newPage();
        await newsPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
        );

        logger.info({ link }, "Loading Naver news article");
        await newsPage.goto(link, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // 기사 정보 추출
        const newsData = await extractNaverNewsContent(newsPage);

        if (newsData.title && newsData.fullText) {
          results.push({
            candidate,
            title: newsData.title,
            link,
            publishDate: newsData.publishDate || new Date().toISOString(),
            fullText: newsData.fullText,
            media: newsData.media || "네이버 뉴스",
          });
          logger.info({ title: newsData.title }, "News scraped successfully");
        } else {
          logger.warn(
            { link },
            "Could not extract title or full text from the Naver news article"
          );
        }

        await newsPage.close();
      } catch (error) {
        logger.error({ error, link }, "Error processing Naver news article");
      }
    }
  } catch (error) {
    logger.error({ error, candidate, keyword }, "Error scraping Naver news");
  } finally {
    await page.close();
  }

  return results;
};

/**
 * 네이버 뉴스 본문 및 메타데이터 추출 함수
 * @param page Puppeteer 페이지 객체
 * @returns 뉴스 메타데이터 및 본문
 */
const extractNaverNewsContent = async (
  page: Page
): Promise<{
  title: string;
  publishDate: string;
  fullText: string;
  media: string;
}> => {
  const html = await page.content();
  const $ = cheerio.load(html);

  // 기본값 설정
  let title = "";
  let publishDate = "";
  let fullText = "";
  let media = "";

  try {
    // 제목 추출 (다양한 선택자 시도)
    title =
      $(".media_end_head_headline").text().trim() ||
      $("#articleTitle").text().trim() ||
      $("h2.end_tit").text().trim() ||
      $("h3.tit-news").text().trim();

    // 언론사 추출
    media =
      $(".media_end_head_top_logo img").attr("alt") ||
      $(".press_logo img").attr("alt") ||
      $(".c_item").first().text().trim();

    // 발행일 추출
    const dateText =
      $(".media_end_head_info_datestamp_time").text().trim() ||
      $(".article_info .author em").text().trim() ||
      $(".t11").first().text().trim();

    // 날짜 포맷팅 (간략화 버전)
    if (dateText) {
      const dateMatch = dateText.match(
        /\d{4}[.년\-]\s*\d{1,2}[.월\-]\s*\d{1,2}/
      );
      publishDate = dateMatch
        ? dateMatch[0].replace(/[년월]/g, "-").replace(/\./g, "-")
        : new Date().toISOString().split("T")[0];
    } else {
      publishDate = new Date().toISOString().split("T")[0];
    }

    // 본문 추출
    fullText =
      $("#newsct_article").text().trim() ||
      $("#articleBodyContents").text().trim() ||
      $("#articeBody").text().trim() ||
      $(".news_end_content").text().trim();

    // 불필요한 텍스트 제거
    fullText = fullText.replace(/\s{2,}/g, " ").trim();
  } catch (error) {
    logger.error({ error }, "Error extracting news content with Cheerio");
  }

  return { title, publishDate, fullText, media };
};

/**
 * 다음 뉴스 스크래핑 함수
 * @param candidate 후보자 이름
 * @param keyword 검색 키워드
 * @returns 스크래핑된 뉴스 목록
 */
export const scrapeDaumNews = async (
  candidate: string,
  keyword: string
): Promise<NewsItem[]> => {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const results: NewsItem[] = [];

  try {
    // 검색 URL 구성
    const searchQuery = `${candidate} ${keyword}`;
    const searchUrl = `https://search.daum.net/search?w=news&q=${encodeURIComponent(
      searchQuery
    )}`;

    logger.info({ url: searchUrl }, "Starting to load Daum search page");

    // 유저 에이전트 설정 (크롤링 방지 우회용)
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
    );

    // 페이지 로드 타임아웃 증가
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
    logger.info({ url: searchUrl }, "Loaded Daum search page");

    // 페이지 HTML 가져와서 로깅 (디버깅용)
    const pageContent = await page.content();
    logger.info(`Page content length: ${pageContent.length} bytes`);

    // 페이지 스크린샷 캡처 (디버깅용)
    await page.screenshot({ path: "daum-search.png" });
    logger.info("Page screenshot saved as daum-search.png");

    // 다양한 선택자 시도 (daum 웹사이트의 구조가 변경되었을 수 있음)
    const newsLinks = await page.evaluate(() => {
      const links: string[] = [];

      // 원래 선택자
      let elements = document.querySelectorAll(".tit-g a");

      // 원래 선택자로 찾지 못하면 대체 선택자 시도
      if (elements.length === 0) {
        elements = document.querySelectorAll(".card-wrap a.link_txt");
      }

      // 또 다른 대체 선택자
      if (elements.length === 0) {
        elements = document.querySelectorAll(".c-item a.tit");
      }

      // 일반적인 뉴스 링크 선택자
      if (elements.length === 0) {
        elements = document.querySelectorAll("a[href*='v.daum.net/v/']");
      }

      console.log("Found elements:", elements.length);

      elements.forEach((el) => {
        const link = el.getAttribute("href");
        if (link) {
          console.log("Found link:", link);
          links.push(link);
        }
      });

      return links.slice(0, 5); // 최대 5개만 처리
    });

    logger.info({ count: newsLinks.length }, "Found news links");

    if (newsLinks.length === 0) {
      logger.warn("No news links found on the page");
      return results;
    }

    // 각 뉴스 링크 방문하여 데이터 추출
    for (const link of newsLinks) {
      try {
        // 새 탭에서 기사 열기
        const newsPage = await browser.newPage();
        await newsPage.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36"
        );

        logger.info({ link }, "Loading news article");
        await newsPage.goto(link, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // 기사 정보 추출 (다음 뉴스 구조에 맞게 추출)
        const newsData = await extractDaumNewsContent(newsPage);

        if (newsData.title && newsData.fullText) {
          results.push({
            candidate,
            title: newsData.title,
            link,
            publishDate: newsData.publishDate || new Date().toISOString(),
            fullText: newsData.fullText,
            media: newsData.media || "다음 뉴스",
          });
          logger.info({ title: newsData.title }, "News scraped successfully");
        } else {
          logger.warn(
            { link },
            "Could not extract title or full text from the news article"
          );
        }

        await newsPage.close();
      } catch (error) {
        logger.error({ error, link }, "Error processing Daum news article");
      }
    }
  } catch (error) {
    logger.error({ error, candidate, keyword }, "Error scraping Daum news");
  } finally {
    await page.close();
  }

  return results;
};

/**
 * 다음 뉴스 본문 및 메타데이터 추출 함수
 * @param page Puppeteer 페이지 객체
 * @returns 뉴스 메타데이터 및 본문
 */
const extractDaumNewsContent = async (
  page: Page
): Promise<{
  title: string;
  publishDate: string;
  fullText: string;
  media: string;
}> => {
  const html = await page.content();
  const $ = cheerio.load(html);

  // 기본값 설정
  let title = "";
  let publishDate = "";
  let fullText = "";
  let media = "";

  try {
    // 제목 추출
    title = $(".tit_view").text().trim() || $(".head_view h3").text().trim();

    // 언론사 추출
    media =
      $(".info_view .txt_info").first().text().trim() ||
      $(".head_view .txt_info").first().text().trim();

    // 발행일 추출
    const dateText =
      $(".info_view span.txt_info").first().next().text().trim() ||
      $(".head_view .txt_info").eq(1).text().trim();

    // 날짜 포맷팅
    if (dateText) {
      const dateMatch = dateText.match(
        /\d{4}[.년\-]\s*\d{1,2}[.월\-]\s*\d{1,2}/
      );
      publishDate = dateMatch
        ? dateMatch[0].replace(/[년월]/g, "-").replace(/\./g, "-")
        : new Date().toISOString().split("T")[0];
    } else {
      publishDate = new Date().toISOString().split("T")[0];
    }

    // 본문 추출
    fullText =
      $(".article_view").text().trim() || $("#harmonyContainer").text().trim();

    // 불필요한 텍스트 제거
    fullText = fullText.replace(/\s{2,}/g, " ").trim();
  } catch (error) {
    logger.error({ error }, "Error extracting Daum news content with Cheerio");
  }

  return { title, publishDate, fullText, media };
};

/**
 * 모든 후보자와 키워드 조합에 대해 뉴스 스크래핑 수행
 * @returns 스크래핑된 뉴스 목록
 */
export const scrapeAllCandidateNews = async (): Promise<NewsItem[]> => {
  let allResults: NewsItem[] = [];

  console.log("Scraping all candidate news", candidateKeywords);
  try {
    for (const { name, keywords } of candidateKeywords) {
      for (const keyword of keywords) {
        // 네이버 뉴스 스크래핑
        const naverResults = await scrapeNaverNews(name, keyword);
        allResults = [...allResults, ...naverResults];

        // 다음 뉴스 스크래핑
        const daumResults = await scrapeDaumNews(name, keyword);
        allResults = [...allResults, ...daumResults];

        // 요청 간격 두기 (크롤링 제한 방지)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    logger.error({ error }, "Error in scrapeAllCandidateNews");
  } finally {
    // 작업 완료 후 브라우저 종료
    await closeBrowser();
  }

  return allResults;
};

export default {
  getBrowser,
  closeBrowser,
  scrapeNaverNews,
  scrapeDaumNews,
  scrapeAllCandidateNews,
};
