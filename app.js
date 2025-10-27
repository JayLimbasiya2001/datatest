const puppeteer = require("puppeteer");

class EmailFinder {
  constructor() {
    this.baseURL = "https://mailmeteor.com/tools/email-finder";
    this.batchSize = 5;
    this.delayBetweenRequests = 15000;
    this.searchTimeout = 300000;
  }

  /**
   * Process names in batches of 5 (headless)
   */
  async processNamesInBatches(names, domain) {
    const results = [];
    const allNames = [...names];
    const emailArray = []; // Array to store only emails

    console.log(
      `Starting email discovery for ${names.length} names at ${domain}`
    );
    console.log(
      `Processing ${this.batchSize} names at a time (headless mode)...\n`
    );

    while (allNames.length > 0) {
      // Take next batch of 5 names
      const batch = allNames.splice(0, this.batchSize);
      console.log(`Processing batch: ${batch.join(", ")}`);

      // Process all 5 names concurrently
      const batchPromises = batch.map((name) =>
        this.findEmailWithMailmeteor(name, domain)
      );

      // Wait for all 5 to complete
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

        console.log(`${name}: ${email || "Not found"}`);
      }

      // Delay between batches if there are more names to process
      if (allNames.length > 0) {
        await this.delay(this.delayBetweenRequests);
      }
    }

    return { detailedResults: results, emailArray: emailArray };
  }

  /**
   * Format domain correctly
   */
  formatDomain(domain) {
    let cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const fullUrl = `https://www.${cleanDomain}/`;
    const encodedDomain = encodeURIComponent(fullUrl);
    return encodedDomain;
  }

  /**
   * Format name correctly
   */
  formatName(name) {
    return name.replace(/ /g, "+");
  }

  /**
   * Find email with proper validation (headless)
   */
  async findEmailWithMailmeteor(name, domain) {
    let browser;
    let page;

    try {
      browser = await puppeteer.launch({
        headless: true, // Changed to true for internal processing
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--window-size=1200,800",
        ],
      });

      page = await browser.newPage();
      await this.setStealthMode(page);

      const formattedName = this.formatName(name);
      const formattedDomain = this.formatDomain(domain);
      const url = `${this.baseURL}?name=${formattedName}&domain=${formattedDomain}`;

      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Handle CAPTCHA if present
      await this.handleCaptcha(page, name);

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
   * Wait for actual email (not loading state)
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
        const errorState = await this.checkForErrorState(page);
        if (errorState && !errorState.includes("loading")) {
          return null;
        }

        // Check if still processing
        if (await this.isStillProcessing(page)) {
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
   * Extract only valid emails (not loading states)
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
   * Check if page is still processing
   */
  async isStillProcessing(page) {
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
   * Get current page status
   */
  async getPageStatus(page) {
    return await page.evaluate(() => {
      // Check the email element text
      const emailElement = document.querySelector(
        "span.email-finder__text.text-secondary"
      );
      if (emailElement) {
        return emailElement.textContent.trim();
      }

      // Check for status messages
      const statusElements = document.querySelectorAll(
        '[class*="status"], [class*="message"]'
      );
      for (const element of statusElements) {
        const text = element.textContent.trim();
        if (text) return text;
      }

      return "Unknown status";
    });
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
   * Set stealth mode
   */
  async setStealthMode(page) {
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
   * Handle CAPTCHA
   */
  async handleCaptcha(page, name) {
    await this.delay(3000);

    const hasCaptcha = await page.evaluate(() => {
      return (
        document.querySelector("[data-sitekey]") !== null ||
        document.querySelector(".cf-turnstile") !== null
      );
    });

    if (hasCaptcha) {
      console.log(`CAPTCHA detected for ${name} - skipping...`);
      return false;
    }
    return true;
  }

  /**
   * Check for error states
   */
  async checkForErrorState(page) {
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
   * Utility function to add delay
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Save results to JSON file with email array
   */
  saveResults(results, filename = "email_results.json") {
    const fs = require("fs");

    // Filter out "loading" emails before saving
    const cleanResults = results.map((result) => ({
      ...result,
      email: this.isValidEmail(result.email) ? result.email : null,
      status: this.isValidEmail(result.email) ? "found" : "not_found",
    }));

    // Create email array
    const emailArray = cleanResults
      .filter((result) => this.isValidEmail(result.email))
      .map((result) => result.email);

    // Save both formats
    const output = {
      detailedResults: cleanResults,
      emailArray: emailArray,
    };

    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.log(`\nResults saved to ${filename}`);
  }

  /**
   * Save only email array to separate file
   */
  saveEmailArray(results, filename = "emails_array.json") {
    const fs = require("fs");

    // Extract only valid emails
    const emailArray = results
      .filter((result) => this.isValidEmail(result.email))
      .map((result) => result.email);

    // Save as simple array
    fs.writeFileSync(filename, JSON.stringify(emailArray, null, 2));
    console.log(`Email array saved to ${filename}`);
  }

  /**
   * Display summary statistics
   */
  displaySummary(results) {
    // Filter out invalid emails for summary
    const validResults = results.filter((r) => this.isValidEmail(r.email));
    const found = validResults.length;
    const notFound = results.length - found;

    console.log("\n=== SUMMARY ===");
    console.log(`Total names processed: ${results.length}`);
    console.log(`Valid emails found: ${found}`);
    console.log(`Emails not found: ${notFound}`);
    console.log(
      `Success rate: ${((found / results.length) * 100).toFixed(1)}%`
    );

    if (found > 0) {
      console.log("\n=== FOUND EMAILS ===");
      validResults.forEach((result) => {
        console.log(`${result.name}: ${result.email}`);
      });
    } else {
      console.log("\n=== NO VALID EMAILS FOUND ===");
    }
  }
}

// Main execution
async function main() {
  console.log("Starting email discovery in headless mode...");
  console.log("Processing 5 names at a time internally...\n");

  const finder = new EmailFinder();

  const names = [
    "Sambit Saha",
    "Vinay Gupta Kurusetti",
    "Monika Asundi",
    "Sweksha Dixit",
    "Leela Chaitanya Yerramsetti",
    "Deepa Seshadri",
    "Saksham Kumar",
    "Madhu Soni",
    "Aravelli ..",
    "Divya Sri",
    "Gangadhar Vasa",
    "Ayushi Mishra",
    "Rasheed S.",
    "M T AHMAD",
    "Bhanushri Chinta",
    "ARKAPRAVA BISWAS",
    "Yuvraj Kesar",
    "Reetika Goswami",
    "Gyanendra Chaubey",
    "MUKESH KUMAR",
    "Ayush Mittal",
    "Shreya Chopra",
    "Raj veerian",
    "Mamta Sinha",
    "Shankramma Basarakod",
    "Akshitha Reddy",
    "Kritika Gujral",
    "Chandana S",
    "Tamasree Ray Chaudhuri",
    "Aditya Verma",
    "Roopa Mahesh",
    "Peeyush Kumar Jaiswal",
    "Krishna Ika",
    "Jasmine Kaur",
    "Harold Kassa",
    "Santosh Kottamasu",
    "Nata Sulakvelidze",
    "Anri Kuparadze",
    "Ashish Singhal",
    "Srini Pillay, M.D.",
    "Kote Gotiashvili",
    "Matthew Adams",
    "Aman Chopra",
    "Elene Aptsiauri",
  ];

  const domain = "https://www.brainwavescience.com/";

  try {
    const startTime = Date.now();
    const { detailedResults, emailArray } = await finder.processNamesInBatches(
      names,
      domain
    );

    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000;

    finder.displaySummary(detailedResults);

    // Save detailed results
    finder.saveResults(detailedResults, "email_results.json");

    // Save only email array
    finder.saveEmailArray(detailedResults, "emails_array.json");

    console.log(
      `\nTotal processing time: ${processingTime.toFixed(2)} seconds`
    );
    console.log(`Found ${emailArray.length} valid emails`);

    return { detailedResults, emailArray };
  } catch (error) {
    console.error("Main execution error:", error);
    process.exit(1);
  }
}

// Export for use in other files
module.exports = EmailFinder;

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}
