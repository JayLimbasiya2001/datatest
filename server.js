const express = require("express");
const path = require("path");
const cors = require("cors");
const LinkedInEmailScraper = require("./combine");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static("."));

// Serve HTML page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Scraping endpoint with Server-Sent Events
app.post("/scrape", async (req, res) => {
  const { companyName, website, maxNames } = req.body;

  console.log(
    `Starting scraping for: ${companyName}, ${website}, ${maxNames} names`
  );

  // Set headers for Server-Sent Events
  res.writeHead(200, {
    "Content-Type": "text/plain",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  try {
    const scraper = new LinkedInEmailScraper();

    // Override console.log to stream logs to client
    const originalConsoleLog = console.log;
    console.log = function (...args) {
      const message = args
        .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : arg))
        .join(" ");

      originalConsoleLog.apply(console, args);

      res.write(
        JSON.stringify({
          type: "log",
          message: message,
          timestamp: new Date().toLocaleTimeString(),
        }) + "\n"
      );
    };

    // Send progress updates
    const sendProgress = (percentage, stage) => {
      res.write(
        JSON.stringify({
          type: "progress",
          percentage: percentage,
          stage: stage,
          timestamp: new Date().toLocaleTimeString(),
        }) + "\n"
      );
    };

    sendProgress(10, "🚀 Starting LinkedIn scraping...");

    // Step 1: Get names from LinkedIn
    sendProgress(30, "🔍 Searching LinkedIn for employee names...");
    const linkedinNames = await scraper.getPeopleFromCompany(
      companyName,
      maxNames
    );

    if (!linkedinNames || linkedinNames.length === 0) {
      throw new Error("No names found from LinkedIn");
    }

    sendProgress(
      50,
      `📝 Found ${linkedinNames.length} names, starting email discovery...`
    );

    // Step 2: Find emails
    sendProgress(70, "📧 Finding emails using Mailmeteor...");
    const emailResults = await scraper.findEmailsForNames(
      linkedinNames,
      website
    );

    // Prepare results
    const foundEmails = emailResults.detailedResults.filter((r) => r.email);
    const successRate = (
      (foundEmails.length / linkedinNames.length) *
      100
    ).toFixed(1);

    sendProgress(90, "💾 Preparing final results...");

    const finalResults = {
      company: companyName,
      website: website,
      linkedinNames: linkedinNames.length,
      emailsFound: foundEmails.length,
      successRate: successRate,
      processingTime: (scraper.totalProcessingTime / 1000).toFixed(2),
      fullResults: {
        company: companyName,
        domain: website,
        scrapedAt: new Date().toISOString(),
        linkedinNames: {
          total: linkedinNames.length,
          names: linkedinNames,
        },
        emailResults: {
          totalProcessed: emailResults.detailedResults.length,
          emailsFound: emailResults.emailArray.length,
          successRate: successRate,
          details: emailResults.detailedResults,
        },
        combined: emailResults.detailedResults.map((result) => ({
          name: result.name,
          email: result.email,
          status: result.status,
          source: "LinkedIn + Email Finder",
        })),
      },
    };

    // Send completion
    res.write(
      JSON.stringify({
        type: "complete",
        results: finalResults,
        timestamp: new Date().toLocaleTimeString(),
      }) + "\n"
    );

    console.log = originalConsoleLog;
    res.end();
  } catch (error) {
    console.error("Scraping error:", error);

    res.write(
      JSON.stringify({
        type: "error",
        message: error.message,
        timestamp: new Date().toLocaleTimeString(),
      }) + "\n"
    );

    res.end();
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(
    `📧 LinkedIn Email Scraper Web Interface available at: http://localhost:${PORT}`
  );
});
