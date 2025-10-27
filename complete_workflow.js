const LinkedInScraper = require("./linkedin_scraper");
const EmailFinder = require("./email_finder"); // Your existing email finder

class CompleteWorkflow {
  constructor() {
    this.linkedinScraper = new LinkedInScraper();
    this.emailFinder = new EmailFinder();
  }

  /**
   * Complete workflow: Get names from LinkedIn -> Find emails
   */
  async completeWorkflow(companyName, domain, maxNames = 50) {
    console.log("🚀 STARTING COMPLETE WORKFLOW");
    console.log(`🏢 Company: ${companyName}`);
    console.log(`🌐 Domain: ${domain}`);
    console.log(`📊 Target: ${maxNames} names\n`);

    // Step 1: Get names from LinkedIn
    console.log("📝 STEP 1: Getting names from LinkedIn...");
    const names = await this.linkedinScraper.getPeopleFromCompany(
      companyName,
      maxNames
    );

    if (names.length === 0) {
      console.log("❌ No names found from LinkedIn. Exiting...");
      return;
    }

    // Step 2: Find emails for the names
    console.log("\n📧 STEP 2: Finding emails...");
    const { detailedResults, emailArray } =
      await this.emailFinder.processNamesInBatches(names, domain);

    // Step 3: Save combined results
    console.log("\n💾 STEP 3: Saving results...");
    this.saveCombinedResults(names, detailedResults, companyName, domain);

    return { names, detailedResults, emailArray };
  }

  /**
   * Save combined LinkedIn + email results
   */
  saveCombinedResults(linkedinNames, emailResults, companyName, domain) {
    const fs = require("fs");

    const output = {
      company: companyName,
      domain: domain,
      scrapedAt: new Date().toISOString(),
      linkedinNames: {
        total: linkedinNames.length,
        names: linkedinNames,
      },
      emailResults: {
        totalProcessed: emailResults.length,
        emailsFound: emailResults.filter((r) => r.email).length,
        successRate: (
          (emailResults.filter((r) => r.email).length / emailResults.length) *
          100
        ).toFixed(1),
        details: emailResults,
      },
      combined: emailResults.map((result) => ({
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
    const successfulEmails = emailResults
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
   * Display final summary
   */
  displayFinalSummary(linkedinNames, emailResults) {
    const foundEmails = emailResults.filter((r) => r.email);

    console.log("\n" + "=".repeat(60));
    console.log("🎉 WORKFLOW COMPLETE - FINAL SUMMARY");
    console.log("=".repeat(60));
    console.log(`📝 Names from LinkedIn: ${linkedinNames.length}`);
    console.log(`📧 Emails found: ${foundEmails.length}`);
    console.log(
      `🎯 Success rate: ${(
        (foundEmails.length / linkedinNames.length) *
        100
      ).toFixed(1)}%`
    );

    console.log("\n✅ FOUND EMAILS:");
    foundEmails.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.name} -> ${result.email}`);
    });

    console.log("=".repeat(60));
  }
}

// Main execution
async function main() {
  const workflow = new CompleteWorkflow();

  // Get parameters from command line
  const companyName = process.argv[2] || "Sonata Software";
  const domain = process.argv[3] || "sonata-software.com";
  const maxNames = parseInt(process.argv[4]) || 30;

  try {
    const results = await workflow.completeWorkflow(
      companyName,
      domain,
      maxNames
    );

    if (results) {
      workflow.displayFinalSummary(results.names, results.detailedResults);
    }
  } catch (error) {
    console.error("💥 Workflow error:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = CompleteWorkflow;
