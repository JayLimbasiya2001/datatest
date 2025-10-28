const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const fs = require("fs");

class LinkedInEmailScraper {
  constructor() {
    this.baseURL = "https://www.linkedin.com";
    this.emailFinderURL = "https://mailmeteor.com/tools/email-finder";
    this.delayBetweenRequests = 3000;
    this.maxNames = 500;
    this.timeout = 120000;
    this.emailBatchSize = 2;
    this.emailDelayBetweenRequests = 3000;
    this.searchTimeout = 400000;
    this.totalProcessingTime = 0;
    this.linkedinScrapingTime = 0;
    this.emailFindingTime = 0;
    this.resultsSavingTime = 0;
  }

  /**
   * Launch browser for Vercel environment
   */
  async launchBrowser() {
    // Configure Chromium for serverless
    chromium.setGraphicsMode(false);
    
    const browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-gpu",
        "--hide-scrollbars",
        "--disable-web-security"
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    return browser;
  }

  /**
   * Main function to get people names and their emails
   */
  async getPeopleAndEmailsFromCompany(companyName, domain, maxNames = 500) {
    const workflowStartTime = Date.now();

    try {
      console.log(`🚀 STARTING COMPLETE WORKFLOW`);
      console.log(`🏢 Company: ${companyName}`);
      console.log(`🌐 Domain: ${domain}`);
      console.log(`📊 Target: ${maxNames} names\n`);
      console.log(`⏰ Workflow started at: ${new Date().toLocaleString()}\n`);

      // Step 1: Get names from LinkedIn
      console.log("📝 STEP 1: Getting names from LinkedIn...");
      const linkedinStartTime = Date.now();
      const linkedinNames = await this.getPeopleFromCompany(
        companyName,
        maxNames
      );
      this.linkedinScrapingTime = Date.now() - linkedinStartTime;

      if (linkedinNames.length === 0) {
        console.log("❌ No names found from LinkedIn. Exiting...");
        return { linkedinNames: [], emailResults: { detailedResults: [], emailArray: [] } };
      }

      // Step 2: Find emails for the names
      console.log("\n📧 STEP 2: Finding emails...");
      const emailStartTime = Date.now();
      const emailResults = await this.findEmailsForNames(linkedinNames, domain);
      this.emailFindingTime = Date.now() - emailStartTime;

      // Step 3: Save combined results
      console.log("\n💾 STEP 3: Saving results...");
      const savingStartTime = Date.now();
      this.saveCombinedResults(
        linkedinNames,
        emailResults,
        companyName,
        domain
      );
      this.resultsSavingTime = Date.now() - savingStartTime;

      // Calculate total time
      this.totalProcessingTime = Date.now() - workflowStartTime;

      // Display summary
      this.displayFinalSummary(linkedinNames, emailResults, companyName, domain);

      return { linkedinNames, emailResults };
    } catch (error) {
      console.error("Error in complete workflow:", error);
      return { linkedinNames: [], emailResults: { detailedResults: [], emailArray: [] } };
    }
  }

  /**
   * Find emails for names using Mailmeteor
   */
  async findEmailsForNames(names, domain) {
    const results = [];
    const allNames = [...names];
    const emailArray = [];

    console.log(
      `Starting email discovery for ${names.length} names at ${domain}`
    );
    console.log(`Processing ${this.emailBatchSize} names at a time...\n`);

    const emailFindingStartTime = Date.now();
    let batchCount = 0;

    while (allNames.length > 0) {
      batchCount++;
      // Take next batch of names
      const batch = allNames.splice(0, this.emailBatchSize);
      console.log(`\n🔄 Processing batch ${batchCount}: ${batch.join(", ")}`);

      // Process all names concurrently
      const batchPromises = batch.map((name) =>
        this.findEmailWithMailmeteor(name, domain)
      );

      // Wait for all to complete
      const batchResults = await Promise.allSettled(batchPromises);

      // Process results
      for (let i = 0; i < batch.length; i++) {
        const name = batch[i];
        const result = batchResults[i];

        const email = result.status === "fulfilled" ? result.value : null;

        results.push({
          name: name,
          email: email,
          domain: domain,
          status: email ? "found" : "not_found",
          timestamp: new Date().toISOString(),
        });

        // Add valid email to array
        if (email && this.isValidEmail(email)) {
          emailArray.push(email);
        }

        console.log(`  ${name}: ${email || "Not found"}`);
      }

      // Delay between batches if there are more names to process
      if (allNames.length > 0) {
        console.log(
          `⏳ Waiting ${
            this.emailDelayBetweenRequests / 1000
          } seconds before next batch...`
        );
        await this.delay(this.emailDelayBetweenRequests);
      }
    }

    const emailFindingEndTime = Date.now();
    console.log(
      `\n✅ Email finding completed in ${(
        (emailFindingEndTime - emailFindingStartTime) /
        1000
      ).toFixed(2)} seconds`
    );

    return { detailedResults: results, emailArray: emailArray };
  }

  /**
   * Find email with Mailmeteor
   */
  async findEmailWithMailmeteor(name, domain) {
    let browser;
    let page;

    try {
      browser = await this.launchBrowser();
      page = await browser.newPage();
      await this.setEmailFinderStealthMode(page);

      const formattedName = this.formatName(name);
      const formattedDomain = this.formatDomain(domain);
      const url = `${this.emailFinderURL}?name=${formattedName}&domain=${formattedDomain}`;

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Handle CAPTCHA if present
      await this.handleEmailCaptcha(page, name);

      // Wait for actual email results
      const email = await this.waitForActualEmail(page, name);

      await browser.close();
      return email;
    } catch (error) {
      console.error(`Error searching for ${name}:`, error.message);
      if (browser) {
        await browser.close();
      }
      return null;
    }
  }

  /**
   * Handle CAPTCHA in Mailmeteor - FIXED METHOD
   */
  async handleEmailCaptcha(page, name) {
    await this.delay(3000);

    const hasCaptcha = await page.evaluate(() => {
      return (
        document.querySelector("[data-sitekey]") !== null ||
        document.querySelector(".cf-turnstile") !== null ||
        document.querySelector(".g-recaptcha") !== null
      );
    });

    if (hasCaptcha) {
      console.log(`CAPTCHA detected for ${name} - skipping...`);
      return false;
    }
    return true;
  }

  /**
   * Wait for actual email from Mailmeteor
   */
  async waitForActualEmail(page, name) {
    const startTime = Date.now();
    const maxWaitTime = this.searchTimeout;

    for (let attempt = 1; attempt <= 30; attempt++) {
      try {
        // Extract email with better validation
        const email = await this.extractValidEmail(page);

        if (email && this.isValidEmail(email)) {
          return email;
        }

        // Check for errors
        const errorState = await this.checkForEmailErrorState(page);
        if (errorState && !errorState.includes("loading")) {
          return null;
        }

        // Check if still processing
        if (await this.isEmailStillProcessing(page)) {
          await this.delay(10000);
          continue;
        }

        await this.delay(10000);

        // Check timeout
        if (Date.now() - startTime > maxWaitTime) {
          return null;
        }
      } catch (error) {
        await this.delay(5000);
      }
    }

    return null;
  }

  /**
   * Extract valid email from Mailmeteor
   */
  async extractValidEmail(page) {
    return await page.evaluate(() => {
      // Primary selector
      const emailElement = document.querySelector(
        "span.email-finder__text.text-secondary"
      );
      if (emailElement) {
        const emailText = emailElement.textContent.trim();
        // Validate it's actually an email, not "loading"
        if (
          emailText &&
          emailText.includes("@") &&
          emailText.includes(".") &&
          emailText.length > 5 &&
          !emailText.includes("loading") &&
          !emailText.includes("Loading") &&
          !emailText.includes("searching") &&
          !emailText.includes("Processing")
        ) {
          return emailText;
        }
      }

      // Additional selectors with validation
      const selectors = [
        ".email-finder__text",
        '[class*="email-result"]',
        '[class*="result-email"]',
        ".email-address",
        "[data-email]",
        ".text-success",
        ".result__email",
      ];

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent.trim();
          if (
            text &&
            text.includes("@") &&
            text.includes(".") &&
            text.length > 5 &&
            !text.includes("loading") &&
            !text.includes("Loading") &&
            !text.includes("searching") &&
            !text.includes("Processing")
          ) {
            return text;
          }
        }
      }

      return null;
    });
  }

  /**
   * Check if Mailmeteor is still processing
   */
  async isEmailStillProcessing(page) {
    return await page.evaluate(() => {
      // Check for loading indicators
      const loadingSelectors = [
        '[class*="loading"]',
        '[class*="spinner"]',
        '[class*="progress"]',
        '[class*="searching"]',
        '[class*="processing"]',
      ];

      for (const selector of loadingSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const style = window.getComputedStyle(element);
          if (style.display !== "none" && style.visibility !== "hidden") {
            return true;
          }
        }
      }

      // Check for loading text in specific elements
      const emailElement = document.querySelector(
        "span.email-finder__text.text-secondary"
      );
      if (emailElement) {
        const text = emailElement.textContent.toLowerCase();
        if (
          text.includes("loading") ||
          text.includes("searching") ||
          text.includes("processing")
        ) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Check for error states in Mailmeteor
   */
  async checkForEmailErrorState(page) {
    return await page.evaluate(() => {
      const errorTexts = [
        "not found",
        "no email",
        "error",
        "invalid",
        "try again",
        "cannot find",
        "600010",
      ];

      const bodyText = document.body.textContent.toLowerCase();
      for (const errorText of errorTexts) {
        if (bodyText.includes(errorText)) {
          return errorText;
        }
      }
      return null;
    });
  }

  /**
   * Format domain for email finder
   */
  formatDomain(domain) {
    let cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const fullUrl = `https://www.${cleanDomain}/`;
    const encodedDomain = encodeURIComponent(fullUrl);
    return encodedDomain;
  }

  /**
   * Format name for email finder
   */
  formatName(name) {
    return name.replace(/ /g, "+");
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    if (!email || typeof email !== "string") return false;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValidFormat = emailRegex.test(email);

    // Check for invalid states
    const invalidStates = [
      "loading",
      "Loading",
      "searching",
      "Searching",
      "processing",
      "Processing",
      "waiting",
      "Waiting",
    ];

    const isNotLoading = !invalidStates.some((state) => email.includes(state));

    return isValidFormat && isNotLoading && email.length > 5;
  }

  /**
   * Set stealth mode for email finder
   */
  async setEmailFinderStealthMode(page) {
    await page.setViewport({ width: 1200, height: 800 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
  }

  /**
   * Get people names from LinkedIn company page
   */
  async getPeopleFromCompany(companyName, maxNames = 500) {
    let browser;
    let page;

    try {
      console.log(`🔍 Searching for people at: ${companyName}`);
      console.log(`📊 Target: ${maxNames} names\n`);

      browser = await this.launchBrowser();
      page = await browser.newPage();
      await this.setStealthMode(page);

      // Login to LinkedIn
      await this.linkedinLogin(page);

      // Get company page and navigate to people section
      const peopleNames = await this.getPeopleFromCompanyPage(
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
   * Get people from company page - navigate to people section
   */
  async getPeopleFromCompanyPage(page, companyName, maxNames) {
    const allNames = new Set();
    const linkedinStartTime = Date.now();

    try {
      // Step 1: Search for company and get to company page
      console.log(`🔎 Step 1: Finding company page for "${companyName}"...`);
      const companyPageUrl = await this.findCompanyPage(page, companyName);

      if (!companyPageUrl) {
        console.log("❌ Could not find company page");
        return [];
      }

      console.log(`🏢 Found company page: ${companyPageUrl}`);

      // Step 2: Navigate to People tab specifically
      console.log("👥 Step 2: Clicking on People tab...");
      const peoplePageUrl = await this.clickPeopleTabOnCompanyPage(
        page,
        companyPageUrl
      );

      if (!peoplePageUrl) {
        console.log("❌ Could not navigate to People tab");
        return [];
      }

      console.log(`✅ Now on People page: ${peoplePageUrl}`);
      await this.delay(5000);

      // Step 3: Scroll and collect all names from people section
      console.log("📝 Step 3: Collecting names from people section...");
      let scrollAttempts = 0;
      const maxScrollAttempts = 200;
      let consecutiveFailures = 0;
      const maxConsecutiveFailures = 10;
      let noMorePeopleDetected = false;

      while (
        allNames.size < maxNames &&
        scrollAttempts < maxScrollAttempts &&
        !noMorePeopleDetected
      ) {
        scrollAttempts++;
        console.log(`\n🔄 Scroll attempt ${scrollAttempts}...`);

        // Extract names from company people page
        const newNames = await this.extractNamesFromPeoplePage(page);
        const beforeSize = allNames.size;

        newNames.forEach((name) => {
          if (this.isValidEmployeeName(name)) {
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

        // Check if there are no more people to load
        noMorePeopleDetected = await this.checkNoMorePeople(page);
        if (noMorePeopleDetected) {
          console.log("🚫 No more people available to load");
          break;
        }

        // Scroll down to load more people
        const hasMorePeople = await this.scrollAndLoadMorePeople(page);

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
      const linkedinEndTime = Date.now();
      console.log(
        `\n✅ Successfully collected ${finalNames.length} names in ${(
          (linkedinEndTime - linkedinStartTime) /
          1000
        ).toFixed(2)} seconds`
      );
      return finalNames;
    } catch (error) {
      console.error("Error in company page method:", error.message);
      return Array.from(allNames);
    }
  }

  /**
   * Check if there are no more people to load
   */
  async checkNoMorePeople(page) {
    return await page.evaluate(() => {
      // Check for "no results" messages
      const noResultsSelectors = [
        ".search-no-results",
        ".no-results",
        ".empty-state",
        "[data-test-no-results]",
        ".org-people__no-results",
        ".artdeco-empty-state",
      ];

      for (const selector of noResultsSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const text = element.textContent?.toLowerCase() || "";
          if (
            text.includes("no results") ||
            text.includes("no employees") ||
            text.includes("no people") ||
            text.includes("0 results")
          ) {
            return true;
          }
        }
      }

      // Check for "Show more results" button that's disabled or not present
      const showMoreButtons = document.querySelectorAll(
        'button[aria-label*="show more"], ' +
          'button[aria-label*="load more"], ' +
          ".scaffold-finite-scroll__load-button"
      );

      // If no show more buttons at all, might be no more results
      if (showMoreButtons.length === 0) {
        // Check if we're seeing a limited set of results
        const resultCountElements = document.querySelectorAll(
          ".search-results-container, " +
            ".org-people__primary-content, " +
            ".scaffold-finite-scroll__content"
        );

        // If we have limited content and no load more button, likely no more results
        if (resultCountElements.length > 0) {
          const totalResultsText = document.body.textContent;
          if (
            totalResultsText.includes("See all") ||
            totalResultsText.includes("limited results") ||
            totalResultsText.includes("preview only")
          ) {
            return true;
          }
        }
      }

      // Check if show more button is disabled
      for (const button of showMoreButtons) {
        if (
          button.disabled ||
          button.getAttribute("aria-disabled") === "true"
        ) {
          return true;
        }
      }

      return false;
    });
  }

  /**
   * Find company page URL by searching
   */
  async findCompanyPage(page, companyName) {
    try {
      // Search for the company
      const searchUrl = `${
        this.baseURL
      }/search/results/all/?keywords=${encodeURIComponent(companyName)}`;
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await this.delay(5000);

      // Click on the first company result
      const companyClicked = await page.evaluate(() => {
        // Look for company links in search results
        const companySelectors = [
          'a[href*="/company/"]',
          ".reusable-search__result-container a",
          ".search-result__result-link",
          ".app-aware-link",
        ];

        for (const selector of companySelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            const href = element.getAttribute("href") || "";
            const text = element.textContent || "";

            // Check if it's a company link and not other types
            if (
              href.includes("/company/") &&
              !href.includes("/search/") &&
              text.length > 0 &&
              !text.toLowerCase().includes("see") &&
              !text.toLowerCase().includes("people")
            ) {
              console.log("Clicking company link:", href, text);
              element.click();
              return true;
            }
          }
        }
        return false;
      });

      if (companyClicked) {
        await this.delay(7000);
        const currentUrl = await page.url();

        // Check if we're on a company page
        if (
          currentUrl.includes("/company/") &&
          !currentUrl.includes("/search/")
        ) {
          console.log(
            `✅ Successfully navigated to company page: ${currentUrl}`
          );
          return currentUrl;
        }
      }

      console.log("❌ Could not find or click company page");
      return null;
    } catch (error) {
      console.error("Error finding company page:", error.message);
      return null;
    }
  }

  /**
   * Click on People tab on company page
   */
  async clickPeopleTabOnCompanyPage(page, companyPageUrl) {
    try {
      // Make sure we're on the company page
      if (!(await page.url()).includes("/company/")) {
        await page.goto(companyPageUrl, { waitUntil: "domcontentloaded" });
        await this.delay(5000);
      }

      // Look for and click the People tab
      const peopleTabClicked = await page.evaluate(() => {
        console.log("Looking for People tab on company page...");

        // Multiple selectors for the People tab
        const peopleTabSelectors = [
          // Main navigation tabs
          '.org-page-navigation__item a[href*="people"]',
          'a[data-control-name="page_member_main_nav_people_tab"]',
          ".org-page-navigation__item a",
          ".global-nav__primary-item a",
          'a[href*="/people/"]',
        ];

        // First try specific selectors
        for (const selector of peopleTabSelectors) {
          const elements = document.querySelectorAll(selector);
          console.log(
            `Trying selector "${selector}": found ${elements.length} elements`
          );

          for (const element of elements) {
            const text = element.textContent?.toLowerCase() || "";
            const href = element.getAttribute("href") || "";

            console.log(`Checking element: "${text}" - ${href}`);

            if (
              (text.includes("people") || href.includes("people")) &&
              !text.includes("all") &&
              !text.includes("see all")
            ) {
              console.log(`✅ Clicking People tab: "${text}"`);
              element.click();
              return true;
            }
          }
        }

        // Fallback: Look for any navigation element with "People" text
        const navElements = document.querySelectorAll(
          "nav a, .global-nav a, .org-page-navigation a"
        );
        for (const element of navElements) {
          const text = element.textContent?.toLowerCase() || "";
          if (text === "people" || text === "employees") {
            console.log(`✅ Clicking People tab (fallback): "${text}"`);
            element.click();
            return true;
          }
        }

        console.log("❌ Could not find People tab");
        return false;
      });

      if (peopleTabClicked) {
        await this.delay(7000);
        const currentUrl = await page.url();

        // Check if we're now on the people page
        if (currentUrl.includes("/people/")) {
          console.log(
            `✅ Successfully navigated to People page: ${currentUrl}`
          );
          return currentUrl;
        } else {
          console.log(
            `⚠️ Clicked People tab but URL didn't change: ${currentUrl}`
          );
          // Try to construct the people URL manually
          const peopleUrl = companyPageUrl.replace(/\/$/, "") + "/people/";
          await page.goto(peopleUrl, { waitUntil: "domcontentloaded" });
          await this.delay(5000);
          return peopleUrl;
        }
      }

      return null;
    } catch (error) {
      console.error("Error clicking People tab:", error.message);
      return null;
    }
  }

  /**
   * Extract names from people page
   */
  async extractNamesFromPeoplePage(page) {
    return await page.evaluate(() => {
      const names = new Set();
      console.log("Extracting names from People page...");

      // Selectors specific to the People section of company pages
      const nameSelectors = [
        // Primary selectors for employee names
        ".org-people-profile-card__profile-title",
        ".org-people__employee-name",
        ".artdeco-entity-lockup__title",
        ".entity-result__title-text",

        // Employee profile cards
        ".org-people-profile-card h3",
        ".org-people-profile-card .name",
        ".employee-card .name",

        // Profile links
        '.org-people-profile-card a[href*="/in/"]',
        '.artdeco-entity-lockup a[href*="/in/"]',
      ];

      // Extract names using selectors
      for (const selector of nameSelectors) {
        const elements = document.querySelectorAll(selector);
        console.log(
          `Selector "${selector}": found ${elements.length} elements`
        );

        for (const element of elements) {
          let name = element.textContent?.trim() || "";

          // Clean up the name
          name = name
            .replace(/[\n\r\t•|–—]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          // Basic validation
          if (
            name &&
            name.length >= 3 &&
            name.includes(" ") &&
            !name.match(/[0-9]/)
          ) {
            console.log("Found name:", name);
            names.add(name);
          }
        }
      }

      console.log(`Total names found: ${names.size}`);
      return Array.from(names);
    });
  }

  /**
   * STRICT validation for employee names only
   */
  isValidEmployeeName(name) {
    if (!name || typeof name !== "string") return false;

    const cleanName = name.trim();

    // Must look like a person's name (First Last)
    if (cleanName.length < 3 || cleanName.length > 50) return false;

    // Must have space (First Last format)
    if (!cleanName.includes(" ")) return false;

    const nameParts = cleanName.split(" ");
    if (nameParts.length < 2) return false;

    // Common invalid patterns to exclude
    const invalidPatterns = [
      "linkedin",
      "search",
      "results",
      "page",
      "view",
      "profile",
      "people",
      "employee",
      "member",
      "follow",
      "connect",
      "message",
      "network",
      "business",
      "premium",
      "data",
      "insights",
      "science",
      "developer",
      "processing",
      "learning",
      "vision",
      "applications",
      "india",
      "corporation",
      "services",
      "options",
      "choices",
      "center",
      "community",
      "generation",
      "analytics",
      "intelligence",
      "outreach",
      "institute",
      "university",
      "college",
      "ad ",
      "help",
      "try",
      "stack",
      "signal",
      "machine",
      "deep",
      "computer",
      "audio",
    ];

    const lowerName = cleanName.toLowerCase();
    for (const pattern of invalidPatterns) {
      if (lowerName.includes(pattern)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Scroll and load more people
   */
  async scrollAndLoadMorePeople(page) {
    return await page.evaluate(async () => {
      const beforeHeight = document.body.scrollHeight;
      console.log("Scrolling... Before height:", beforeHeight);

      // Scroll to bottom
      window.scrollTo(0, document.body.scrollHeight);

      // Wait for content to load
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Check for "Show more" buttons
      const showMoreSelectors = [
        'button[aria-label*="show more"]',
        'button[aria-label*="load more"]',
        ".scaffold-finite-scroll__load-button",
        ".artdeco-button--secondary",
        "button.scaffold-finite-scroll__load-button",
      ];

      for (const selector of showMoreSelectors) {
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
   * Set stealth mode for LinkedIn
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
   * Save combined results
   */
  saveCombinedResults(linkedinNames, emailResults, companyName, domain) {
    const output = {
      company: companyName,
      domain: domain,
      scrapedAt: new Date().toISOString(),
      timing: {
        totalProcessingTime: this.totalProcessingTime,
        linkedinScrapingTime: this.linkedinScrapingTime,
        emailFindingTime: this.emailFindingTime,
        resultsSavingTime: this.resultsSavingTime,
        workflowStartTime: new Date().toISOString(),
      },
      linkedinNames: {
        total: linkedinNames.length,
        names: linkedinNames,
      },
      emailResults: {
        totalProcessed: emailResults.detailedResults.length,
        emailsFound: emailResults.emailArray.length,
        successRate: (
          (emailResults.emailArray.length /
            emailResults.detailedResults.length) *
          100
        ).toFixed(1),
        details: emailResults.detailedResults,
      },
      combined: emailResults.detailedResults.map((result) => ({
        name: result.name,
        email: result.email,
        status: result.status,
        source: "LinkedIn + Email Finder",
      })),
    };

    const filename = `results_${companyName.replace(
      /\s+/g,
      "_"
    )}_${new Date().getTime()}.json`;
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));

    console.log(`✅ Combined results saved to: ${filename}`);

    // Also save just the successful emails
    const successfulEmails = emailResults.detailedResults
      .filter((r) => r.email)
      .map((r) => r.email);

    fs.writeFileSync(
      `emails_${companyName.replace(/\s+/g, "_")}.json`,
      JSON.stringify(successfulEmails, null, 2)
    );
    console.log(
      `✅ Email list saved to: emails_${companyName.replace(/\s+/g, "_")}.json`
    );
  }

  /**
   * Display final summary with detailed timing
   */
  displayFinalSummary(linkedinNames, emailResults, companyName, domain) {
    const foundEmails = emailResults.detailedResults.filter((r) => r.email);

    console.log("\n" + "=".repeat(70));
    console.log("🎉 WORKFLOW COMPLETE - DETAILED SUMMARY");
    console.log("=".repeat(70));
    console.log(`🏢 Company: ${companyName}`);
    console.log(`🌐 Domain: ${domain}`);
    console.log(`📝 Names from LinkedIn: ${linkedinNames.length}`);
    console.log(`📧 Emails found: ${foundEmails.length}`);
    console.log(
      `🎯 Success rate: ${(
        (foundEmails.length / linkedinNames.length) *
        100
      ).toFixed(1)}%`
    );

    console.log("\n⏱️  DETAILED TIMING BREAKDOWN:");
    console.log("-".repeat(40));
    console.log(
      `Total Processing Time: ${(this.totalProcessingTime / 1000).toFixed(2)}s`
    );
    console.log(
      `LinkedIn Scraping: ${(this.linkedinScrapingTime / 1000).toFixed(2)}s`
    );
    console.log(`Email Finding: ${(this.emailFindingTime / 1000).toFixed(2)}s`);
    console.log(
      `Results Saving: ${(this.resultsSavingTime / 1000).toFixed(2)}s`
    );

    // Calculate percentages
    const linkedinPercentage = (
      (this.linkedinScrapingTime / this.totalProcessingTime) *
      100
    ).toFixed(1);
    const emailPercentage = (
      (this.emailFindingTime / this.totalProcessingTime) *
      100
    ).toFixed(1);
    const savingPercentage = (
      (this.resultsSavingTime / this.totalProcessingTime) *
      100
    ).toFixed(1);

    console.log(`\n📊 TIME DISTRIBUTION:`);
    console.log(`LinkedIn: ${linkedinPercentage}%`);
    console.log(`Email Finding: ${emailPercentage}%`);
    console.log(`Saving: ${savingPercentage}%`);

    if (foundEmails.length > 0) {
      console.log("\n✅ FOUND EMAILS:");
      foundEmails.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.name} -> ${result.email}`);
      });
    } else {
      console.log("\n❌ NO EMAILS FOUND");
    }

    console.log("=".repeat(70));
  }
}

// For Vercel serverless function compatibility
module.exports = LinkedInEmailScraper;

module.exports.handler = async (req, res) => {
  const scraper = new LinkedInEmailScraper();
  
  try {
    const { companyName, domain, maxNames = 50 } = req.body || req.query;
    
    if (!companyName || !domain) {
      return res.status(400).json({
        error: "Company name and domain are required"
      });
    }

    const results = await scraper.getPeopleAndEmailsFromCompany(
      companyName, 
      domain, 
      parseInt(maxNames)
    );

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    console.error("Handler error:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Main execution function for local testing
async function main() {
  const scraper = new LinkedInEmailScraper();

  // Get parameters from command line or use defaults
  const companyName = process.argv[2] || "Brainwave Science";
  const domain = process.argv[3] || "https://www.brainwavescience.com/";
  const maxNames = parseInt(process.argv[4]) || 100;

  console.log("🚀 Starting Complete LinkedIn + Email Scraper...");
  console.log(`🏢 Company: ${companyName}`);
  console.log(`🌐 Domain: ${domain}`);
  console.log(`🎯 Target: ${maxNames} names\n`);
  console.log(`⏰ Script started at: ${new Date().toLocaleString()}\n`);

  try {
    const startTime = Date.now();

    const results = await scraper.getPeopleAndEmailsFromCompany(
      companyName,
      domain,
      maxNames
    );

    const endTime = Date.now();
    const totalScriptTime = (endTime - startTime) / 1000;

    if (results && results.linkedinNames && results.emailResults) {
      console.log(
        `\n⏱️ Total script execution time: ${totalScriptTime.toFixed(
          2
        )} seconds`
      );
      console.log(`📊 ${results.linkedinNames.length} names processed`);
      console.log(`📧 ${results.emailResults.emailArray.length} emails found`);
      console.log(`\n🏁 Script completed at: ${new Date().toLocaleString()}`);
    }
  } catch (error) {
    console.error("💥 Error in main execution:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
