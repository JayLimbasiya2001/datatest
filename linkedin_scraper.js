const puppeteer = require("puppeteer");
const fs = require("fs");

class LinkedInScraper {
  constructor() {
    this.baseURL = "https://www.linkedin.com";
    this.delayBetweenRequests = 3000;
    this.maxNames = 500;
    this.timeout = 120000;
  }

  /**
   * Main function to get people names from a company
   */
  async getPeopleFromCompany(companyName, maxNames = 500) {
    let browser;
    let page;

    try {
      console.log(`🔍 Searching for people at: ${companyName}`);
      console.log(`📊 Target: ${maxNames} names\n`);

      browser = await puppeteer.launch({
        headless: false,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1400,1000",
          "--disable-features=VizDisplayCompositor",
        ],
      });

      page = await browser.newPage();
      await this.setStealthMode(page);

      // Login to LinkedIn
      await this.linkedinLogin(page);

      // Simple approach: Search company name and click first result
      const peopleNames = await this.simpleCompanySearchApproach(
        page,
        companyName,
        maxNames
      );

      // Remove duplicates and return
      const uniqueNames = [...new Set(peopleNames)].slice(0, maxNames);
      return uniqueNames;
    } catch (error) {
      console.error("Error in LinkedIn scraping:", error);
      return [];
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * SIMPLE APPROACH: Search company name and click first result
   */
  async simpleCompanySearchApproach(page, companyName, maxNames) {
    const allNames = new Set();

    try {
      // Step 1: Go to LinkedIn homepage
      console.log("🌐 Step 1: Going to LinkedIn homepage...");
      await page.goto(this.baseURL, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await this.delay(5000);

      // Step 2: Search for company name in search box (NO FILTERS)
      console.log(`🔎 Step 2: Searching for "${companyName}"...`);
      const searchSuccess = await this.simpleSearch(page, companyName);

      if (!searchSuccess) {
        console.log("❌ Could not perform search");
        return [];
      }

      await this.delay(5000);

      // Step 3: Click on the first company result
      console.log("👆 Step 3: Clicking on first company result...");
      const companyClicked = await this.clickFirstCompanyResult(page);

      if (!companyClicked) {
        console.log("❌ Could not find company result");
        return [];
      }

      await this.delay(7000);

      // Step 4: Click on "People" tab in company page
      console.log("👥 Step 4: Navigating to People section...");
      const peopleTabClicked = await this.clickCompanyPeopleTab(page);

      if (!peopleTabClicked) {
        console.log("❌ Could not find People tab");
        return [];
      }

      await this.delay(5000);

      // Step 5: Scroll and collect all names from people section
      console.log("📝 Step 5: Collecting names from people section...");
      let scrollAttempts = 0;
      const maxScrollAttempts = 200;
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 10;

      while (allNames.size < maxNames && scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        console.log(`\n🔄 Scroll attempt ${scrollAttempts}...`);

        // Extract names from company people page
        const newNames = await this.extractNamesFromCompanyPeople(page);
        const beforeSize = allNames.size;

        newNames.forEach((name) => {
          if (this.isValidName(name)) {
            allNames.add(name);
          }
        });

        const newCount = allNames.size - beforeSize;
        console.log(
          `📝 Found ${newNames.length} names, ${newCount} new unique names`
        );
        console.log(`📊 Total: ${allNames.size}/${maxNames}`);

        if (newCount === 0) {
          consecutiveFailures++;
          console.log(
            `⚠️ No new names found (${consecutiveFailures}/${maxConsecutiveFailures})`
          );
        } else {
          consecutiveFailures = 0;
        }

        // Scroll down to load more people
        const hasMorePeople = await this.scrollCompanyPeoplePage(page);

        if (
          (!hasMorePeople && newCount === 0) ||
          consecutiveFailures >= maxConsecutiveFailures
        ) {
          console.log("🚫 No more people to load");
          break;
        }

        // Random delay to avoid detection
        await this.delay(2000 + Math.random() * 2000);

        if (allNames.size >= maxNames) {
          break;
        }
      }

      const finalNames = Array.from(allNames);
      console.log(`\n✅ Successfully collected ${finalNames.length} names`);
      return finalNames;
    } catch (error) {
      console.error("Error in simple approach:", error.message);
      return Array.from(allNames);
    }
  }

  /**
   * Simple search - just type in search box and press enter
   */
  async simpleSearch(page, companyName) {
    return await page.evaluate((company) => {
      // Find the main search box
      const searchSelectors = [
        'input[placeholder*="Search"]',
        'input[aria-label*="Search"]',
        "input.search-global-typeahead__input",
        ".search-global-typeahead__input",
        'input[type="text"]',
      ];

      for (const selector of searchSelectors) {
        const searchBox = document.querySelector(selector);
        if (searchBox) {
          // Focus and clear the search box
          searchBox.focus();
          searchBox.value = "";

          // Type the company name
          searchBox.value = company;

          // Trigger input event
          searchBox.dispatchEvent(new Event("input", { bubbles: true }));

          // Wait a bit for suggestions
          setTimeout(() => {
            // Press Enter to search
            const enterEvent = new KeyboardEvent("keydown", {
              key: "Enter",
              code: "Enter",
              keyCode: 13,
              which: 13,
              bubbles: true,
            });
            searchBox.dispatchEvent(enterEvent);
          }, 1000);

          return true;
        }
      }
      return false;
    }, companyName);
  }

  /**
   * Click on the first company result in search results
   */
  async clickFirstCompanyResult(page) {
    return await page.evaluate(() => {
      // Wait a bit for search results to load
      setTimeout(() => {}, 2000);

      // Look for company results - any link that looks like a company page
      const allLinks = document.querySelectorAll("a");

      for (const link of allLinks) {
        const href = link.getAttribute("href") || "";
        const text = link.textContent || "";

        // Company page indicators
        const isCompanyLink =
          href.includes("/company/") &&
          !href.includes("/search/") &&
          !href.includes("/dir/");

        const looksLikeCompany =
          text.length > 0 &&
          !text.includes("See") &&
          !text.includes("View") &&
          !text.includes("People") &&
          !text.includes("Jobs");

        if (isCompanyLink && looksLikeCompany) {
          console.log("Found company link:", href, text);
          link.click();
          return true;
        }
      }

      // If no company links found, try clicking any result that looks like a company
      const potentialResults = document.querySelectorAll(
        ".reusable-search__result-container, " +
          ".search-result__result-link, " +
          ".app-aware-link, " +
          ".entity-result__item"
      );

      for (const result of potentialResults) {
        const text = result.textContent || "";
        if (
          text.length > 10 &&
          !text.includes("People") &&
          !text.includes("Jobs")
        ) {
          console.log("Trying result:", text.substring(0, 50));
          const link = result.querySelector("a");
          if (link) {
            link.click();
            return true;
          }
        }
      }

      return false;
    });
  }

  /**
   * Click on People tab in company page
   */
  async clickCompanyPeopleTab(page) {
    return await page.evaluate(() => {
      console.log("Looking for People tab...");

      // First, let's check if we're already on a people page
      const currentUrl = window.location.href;
      if (currentUrl.includes("/people/")) {
        console.log("Already on people page");
        return true;
      }

      // Multiple selectors for People tab
      const peopleTabSelectors = [
        'a[href*="people"]',
        'button[data-control-name*="people"]',
        ".org-page-navigation__item a",
        "a.org-page-navigation__item-link",
        "nav a",
        ".global-nav__nav-item a",
      ];

      // Try each selector
      for (const selector of peopleTabSelectors) {
        const elements = document.querySelectorAll(selector);
        console.log(`Selector ${selector}: found ${elements.length} elements`);

        for (const element of elements) {
          const text = element.textContent?.toLowerCase() || "";
          const href = element.getAttribute("href") || "";

          console.log("Checking element:", text.substring(0, 30), href);

          if (
            (text.includes("people") || href.includes("people")) &&
            !text.includes("all") &&
            !text.includes("see all")
          ) {
            console.log("Clicking People tab:", text);
            element.click();
            return true;
          }
        }
      }

      // Fallback: Look for any element with "People" text
      const allElements = document.querySelectorAll("a, button, span, div");
      for (const element of allElements) {
        const text = element.textContent?.toLowerCase() || "";
        if (text === "people" || text === "employees") {
          console.log("Found People text element:", text);
          element.click();
          return true;
        }
      }

      console.log("Could not find People tab");
      return false;
    });
  }

  /**
   * Extract names from company people page
   */
  async extractNamesFromCompanyPeople(page) {
    return await page.evaluate(() => {
      const names = new Set();
      console.log("Extracting names from page...");

      // Multiple selectors for names in people pages
      const nameSelectors = [
        ".org-people-profile-card__profile-title",
        ".org-people__employee-name",
        ".employee-name",
        ".artdeco-entity-lockup__title",
        ".entity-result__title-text",
        '[class*="name"]',
        ".name",
        ".profile-name",
        'a[href*="/in/"]',
        ".ember-view .name",
        ".lt-line-clamp__line",
      ];

      for (const selector of nameSelectors) {
        const elements = document.querySelectorAll(selector);
        console.log(`Selector ${selector}: ${elements.length} elements`);

        for (const element of elements) {
          let name = element.textContent?.trim() || "";

          // Clean up the name
          name = name
            .replace(/[\n\r\t•|–—]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          // Basic name validation
          if (
            name &&
            name.length >= 3 &&
            name.includes(" ") &&
            name.split(" ").length >= 2 &&
            !name.match(/[0-9]/) &&
            !name.toLowerCase().includes("linkedin") &&
            !name.toLowerCase().includes("people") &&
            !name.toLowerCase().includes("employee")
          ) {
            console.log("Found name:", name);
            names.add(name);
          }
        }
      }

      // Also try to extract from any text that looks like a name
      const allText = document.body.textContent;
      const nameRegex = /[A-Z][a-z]+ [A-Z][a-z]+/g;
      const matches = allText.match(nameRegex) || [];

      for (const match of matches) {
        if (match.length > 3 && match.includes(" ")) {
          names.add(match);
        }
      }

      console.log(`Total names found: ${names.size}`);
      return Array.from(names);
    });
  }

  /**
   * Scroll company people page to load more employees
   */
  async scrollCompanyPeoplePage(page) {
    return await page.evaluate(async () => {
      const beforeHeight = document.body.scrollHeight;
      console.log("Scrolling... Before height:", beforeHeight);

      // Scroll to bottom
      window.scrollTo(0, document.body.scrollHeight);

      // Wait for content to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check for "Show more" buttons
      const showMoreButtons = [
        'button[aria-label*="show more"]',
        'button[aria-label*="load more"]',
        ".scaffold-finite-scroll__load-button",
        ".artdeco-button--secondary",
        'button:contains("Show more")',
        'button:contains("Load more")',
      ];

      for (const selector of showMoreButtons) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && button.offsetParent !== null) {
            try {
              console.log("Clicking show more button");
              button.scrollIntoView({ behavior: "smooth", block: "center" });
              await new Promise((resolve) => setTimeout(resolve, 1000));
              button.click();
              await new Promise((resolve) => setTimeout(resolve, 4000));
              return true;
            } catch (e) {
              console.log("Button click failed:", e);
            }
          }
        }
      }

      // Check if new content loaded
      const newHeight = document.body.scrollHeight;
      console.log("After height:", newHeight);
      const hasNewContent = newHeight > beforeHeight;

      return hasNewContent;
    });
  }

  /**
   * LinkedIn login
   */
  async linkedinLogin(page) {
    try {
      const credentials = this.getLinkedInCredentials();
      if (!credentials.email || !credentials.password) {
        console.log("⚠️  No LinkedIn credentials provided");
        return false;
      }

      console.log("🔐 Logging into LinkedIn...");
      await page.goto(`${this.baseURL}/login`, {
        waitUntil: "domcontentloaded",
      });

      // Wait for login form
      await page.waitForFunction(
        () =>
          document.querySelector("#username") ||
          document.querySelector('[name="session_key"]'),
        { timeout: 15000 }
      );

      const usernameField =
        (await page.$("#username")) || (await page.$('[name="session_key"]'));
      const passwordField =
        (await page.$("#password")) ||
        (await page.$('[name="session_password"]'));

      if (usernameField && passwordField) {
        await usernameField.type(credentials.email, { delay: 100 });
        await passwordField.type(credentials.password, { delay: 100 });

        const submitButton = await page.$('button[type="submit"]');
        if (submitButton) {
          await submitButton.click();
          await Promise.race([
            page.waitForNavigation({
              waitUntil: "domcontentloaded",
              timeout: 20000,
            }),
            page.waitForSelector(".global-nav", { timeout: 20000 }),
          ]);
          console.log("✅ Successfully logged into LinkedIn");
          await this.delay(3000);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.log("❌ Login failed:", error.message);
      return false;
    }
  }

  /**
   * Set stealth mode
   */
  async setStealthMode(page) {
    await page.setViewport({ width: 1400, height: 1000 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
  }

  /**
   * Validate name format
   */
  isValidName(name) {
    if (!name || typeof name !== "string") return false;
    const cleanName = name.trim();
    return (
      cleanName.length >= 3 &&
      cleanName.includes(" ") &&
      cleanName.split(" ").length >= 2 &&
      cleanName.split(" ").length <= 5 &&
      !cleanName.match(/[0-9]/) &&
      !cleanName.toLowerCase().includes("linkedin") &&
      !cleanName.toLowerCase().includes("search") &&
      !cleanName.toLowerCase().includes("people")
    );
  }

  /**
   * Get LinkedIn credentials
   */
  getLinkedInCredentials() {
    if (process.env.LINKEDIN_EMAIL && process.env.LINKEDIN_PASSWORD) {
      return {
        email: process.env.LINKEDIN_EMAIL,
        password: process.env.LINKEDIN_PASSWORD,
      };
    }
    try {
      if (fs.existsSync("./linkedin_config.json")) {
        const config = JSON.parse(
          fs.readFileSync("./linkedin_config.json", "utf8")
        );
        return {
          email: config.email || "",
          password: config.password || "",
        };
      }
    } catch (error) {}
    return { email: "", password: "" };
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Save names to file
   */
  saveNamesToFile(names, filename = "linkedin_names.json") {
    const output = {
      scrapedAt: new Date().toISOString(),
      totalNames: names.length,
      names: names,
    };
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.log(`\n💾 Names saved to: ${filename}`);
  }

  /**
   * Display summary
   */
  displaySummary(names, companyName) {
    console.log("\n" + "=".repeat(60));
    console.log("🎯 LINKEDIN SCRAPING SUMMARY");
    console.log("=".repeat(60));
    console.log(`🏢 Company: ${companyName}`);
    console.log(`📊 Names collected: ${names.length}`);
    if (names.length > 0) {
      console.log("\n👤 Sample names found:");
      names.slice(0, 15).forEach((name, index) => {
        console.log(`   ${index + 1}. ${name}`);
      });
      if (names.length > 15) {
        console.log(`   ... and ${names.length - 15} more`);
      }
    } else {
      console.log("\n❌ No names were collected");
    }
    console.log("=".repeat(60));
  }
}

// Main execution function
async function main() {
  const scraper = new LinkedInScraper();
  const companyName = process.argv[2] || "Microsoft";
  const maxNames = parseInt(process.argv[3]) || 500;

  console.log("🚀 Starting LinkedIn People Scraper...");
  console.log(`🏢 Company: ${companyName}`);
  console.log(`🎯 Target: ${maxNames} names\n`);

  try {
    const names = await scraper.getPeopleFromCompany(companyName, maxNames);
    scraper.displaySummary(names, companyName);

    const filename = `linkedin_names_${companyName.replace(/\s+/g, "_")}.json`;
    scraper.saveNamesToFile(names, filename);

    return names;
  } catch (error) {
    console.error("💥 Error in main execution:", error);
    process.exit(1);
  }
}

// Export the class
module.exports = LinkedInScraper;

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
